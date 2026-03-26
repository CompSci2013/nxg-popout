/**
 * Pop-out Manager Service
 *
 * Manages pop-out window lifecycle using Angular CDK Portals.
 * Opens `about:blank` windows and renders Angular components into them
 * via DomPortalOutlet — no full app bootstrap, no router, no auth guards.
 *
 * The parent window's Angular context drives change detection,
 * so ngModel, *ngIf, pipes, and DI all work in the pop-out.
 *
 * This service is a TRANSPORT LAYER. It knows nothing about URLs,
 * filters, or domain state. The consuming application closes the
 * URL-First loop by subscribing to messages$ and calling its own
 * URL state management.
 */

import {
  Injectable,
  NgZone,
  OnDestroy,
  ApplicationRef,
  ComponentFactoryResolver,
  Injector,
  SimpleChange,
  Type,
  EventEmitter
} from '@angular/core';
import { PopOutContextService } from './popout-context.service';
import { DomPortalOutlet, ComponentPortal } from '@angular/cdk/portal';
import { Subject } from 'rxjs';
import {
  buildWindowFeatures,
  PopOutMessage,
  PopOutMessageType,
  PopOutWindowFeatures,
  PopOutWindowRef
} from './popout.interface';

@Injectable()
export class PopOutManagerService implements OnDestroy {
  private poppedOutPanels = new Set<string>();
  private popoutWindows = new Map<string, PopOutWindowRef>();
  private messagesSubject = new Subject<{ panelId: string; message: PopOutMessage }>();
  private closedSubject = new Subject<string>();
  private blockedSubject = new Subject<string>();
  private beforeUnloadHandler = () => this.closeAllPopOuts();
  private initialized = false;
  private hostInjector!: Injector;

  readonly messages$ = this.messagesSubject.asObservable();
  readonly closed$ = this.closedSubject.asObservable();
  readonly blocked$ = this.blockedSubject.asObservable();

  constructor(
    private ngZone: NgZone,
    private componentFactoryResolver: ComponentFactoryResolver,
    private appRef: ApplicationRef,
    private injector: Injector
  ) {}

  /**
   * Initialize the manager. Call once from the host component.
   *
   * @param hostInjector - The host component's Injector. Portal-rendered components
   *   inherit this injector's DI context, so they can access component-level providers
   *   (e.g. ResourceManagementService provided by the host component).
   */
  initialize(hostInjector?: Injector): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.hostInjector = hostInjector || this.injector;
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
  }

  isPoppedOut(panelId: string): boolean {
    return this.poppedOutPanels.has(panelId);
  }

  getPoppedOutPanels(): string[] {
    return Array.from(this.poppedOutPanels);
  }

  /**
   * Open a pop-out window and render an Angular component into it.
   *
   * @param panelId - Unique panel identifier
   * @param componentType - Angular component class to render
   * @param data - Data to set on the component instance (key → property)
   * @param features - Optional window size/position
   * @returns true if pop-out opened successfully
   */
  openPopOut(
    panelId: string,
    componentType: Type<any>,
    data: Record<string, any>,
    features?: Partial<PopOutWindowFeatures>
  ): boolean {
    if (this.poppedOutPanels.has(panelId)) {
      return false;
    }

    const windowFeatures = buildWindowFeatures({
      width: 1200,
      height: 800,
      left: 100,
      top: 100,
      resizable: true,
      scrollbars: true,
      ...features
    });

    const popoutWindow = window.open('about:blank', `panel-${panelId}`, windowFeatures);

    if (!popoutWindow) {
      this.blockedSubject.next(panelId);
      return false;
    }

    // Write minimal HTML skeleton (no styles yet — component styles don't exist until attachment)
    this.writePopoutDocument(popoutWindow);

    // Create PopOutContextService instance for this pop-out.
    // Portal-rendered components can @Optional() inject this to detect
    // they're in a pop-out and wait for the environment to be ready.
    const popOutContext = new PopOutContextService();

    // Create a child injector that provides PopOutContextService
    // alongside the host's DI context (ResourceManagementService, etc.)
    const portalInjector = Injector.create({
      providers: [{ provide: PopOutContextService, useValue: popOutContext }],
      parent: this.hostInjector
    });

    // Create CDK portal outlet targeting the popout's body.
    const outlet = new DomPortalOutlet(
      popoutWindow.document.body,
      this.componentFactoryResolver,
      this.appRef,
      portalInjector
    );

    // Attach component via portal — this triggers Angular to generate component styles
    const portal = new ComponentPortal(componentType);
    const componentRef = outlet.attach(portal);

    // NOW copy styles (including the component styles Angular just created)
    this.copyStylesToPopout(popoutWindow);

    // Watch for late style injections (Plotly, lazy-loaded components, etc.)
    const styleObserver = this.observeParentStyles(popoutWindow);

    // Forward drag-continuation events from popout document to parent document.
    // Libraries like Plotly bind mousemove/mouseup to the parent's `document` during
    // drag operations. When the DOM lives in the popout window, those events fire on
    // the popout's document instead — so the drag handlers never trigger. Forwarding
    // bridges this gap.
    const eventForwardingController = this.forwardDragEvents(popoutWindow);

    // Set data on component instance
    if (data) {
      Object.keys(data).forEach(key => {
        (componentRef.instance as any)[key] = data[key];
      });
    }

    // Set window title from data.title, or fall back to panelId
    popoutWindow.document.title = (data?.['title'] as string) || panelId;

    // Wire up all @Output() EventEmitters as messages
    this.wireComponentOutputs(componentRef.instance, panelId);

    // Signal that the pop-out environment is ready.
    // Styles are copied, event forwarding is active, data is set.
    // Components subscribed to ready$ can now safely re-initialize
    // DOM-dependent libraries (e.g. Plotly).
    popOutContext.signalReady();

    this.poppedOutPanels.add(panelId);

    // Set up BroadcastChannel for this panel
    const channel = new BroadcastChannel(`panel-${panelId}`);

    channel.onmessage = event => {
      this.ngZone.run(() => {
        this.messagesSubject.next({ panelId, message: event.data });
      });
    };

    // Poll for window close
    const checkInterval = window.setInterval(() => {
      if (popoutWindow.closed) {
        this.ngZone.run(() => {
          this.handlePopOutClosed(panelId);
        });
      }
    }, 500);

    this.popoutWindows.set(panelId, {
      window: popoutWindow,
      channel,
      checkInterval,
      panelId,
      panelType: componentType.name,
      outlet,
      componentRef,
      styleObserver,
      eventForwardingController
    });

    return true;
  }

  /**
   * Auto-discover and subscribe to all @Output() EventEmitters on the component.
   * Each emission is relayed as a COMPONENT_OUTPUT message with the output name.
   */
  private wireComponentOutputs(instance: any, panelId: string): void {
    const proto = Object.getPrototypeOf(instance);
    const allKeys = new Set([
      ...Object.keys(instance),
      ...Object.getOwnPropertyNames(proto)
    ]);

    for (const key of allKeys) {
      try {
        const value = instance[key];
        if (value instanceof EventEmitter) {
          value.subscribe((payload: any) => {
            this.messagesSubject.next({
              panelId,
              message: {
                type: PopOutMessageType.COMPONENT_OUTPUT,
                payload: { outputName: key, data: payload },
                timestamp: Date.now()
              }
            });
          });
        }
      } catch {
        // Skip properties that throw on access (getters with side effects, etc.)
      }
    }
  }

  /**
   * Update a property on a popout component instance.
   */
  updatePopoutData(panelId: string, key: string, value: any): void {
    const ref = this.popoutWindows.get(panelId);
    if (ref?.componentRef) {
      (ref.componentRef.instance as any)[key] = value;
    }
  }

  /**
   * Set multiple @Input() properties on a popout component and trigger ngOnChanges.
   *
   * Portal-rendered components don't have a parent template re-evaluating bindings.
   * This method simulates what Angular's template binding does:
   *   1. Set properties on the instance
   *   2. Build SimpleChanges for changed properties
   *   3. Call ngOnChanges() if the component implements it
   *   4. Run detectChanges() to flush the view
   *
   * Domain-agnostic: the caller decides which properties to sync.
   */
  setPopoutInputs(panelId: string, inputs: Record<string, any>): void {
    const ref = this.popoutWindows.get(panelId);
    if (!ref?.componentRef) return;

    const instance = ref.componentRef.instance;
    const changes: Record<string, SimpleChange> = {};
    let hasChanged = false;

    for (const key of Object.keys(inputs)) {
      const previousValue = instance[key];
      const currentValue = inputs[key];

      if (previousValue !== currentValue) {
        instance[key] = currentValue;
        changes[key] = new SimpleChange(previousValue, currentValue, false);
        hasChanged = true;
      }
    }

    if (hasChanged && typeof instance.ngOnChanges === 'function') {
      instance.ngOnChanges(changes);
    }

    ref.componentRef.changeDetectorRef.detectChanges();
  }

  /**
   * Broadcast state to all popout windows via BroadcastChannel,
   * and trigger change detection on all portal-rendered components.
   *
   * Portal components share the host's DI context (same ResourceManagementService),
   * so their data is already current. But with OnPush change detection and no parent
   * template re-evaluating bindings, they need an explicit CD kick.
   */
  broadcastState(state: any, extra?: any): void {
    if (this.popoutWindows.size === 0) {
      return;
    }

    const message: PopOutMessage = {
      type: PopOutMessageType.STATE_UPDATE,
      payload: {
        state,
        ...(extra ? { extra } : {})
      },
      timestamp: Date.now()
    };

    this.popoutWindows.forEach(({ channel, componentRef }) => {
      try {
        channel.postMessage(message);
      } catch {
        // Silently ignore posting errors
      }

      // Trigger change detection on portal-rendered component.
      // The component's data is already current (shared ResourceManagementService),
      // but OnPush won't re-evaluate without this kick.
      try {
        componentRef.changeDetectorRef.markForCheck();
        componentRef.changeDetectorRef.detectChanges();
      } catch (e) {
        console.warn('[PopOutManager] detectChanges failed for portal component:', e);
      }
    });
  }

  /**
   * Send a message to a specific popout window.
   */
  sendToPopout(panelId: string, message: PopOutMessage): void {
    const ref = this.popoutWindows.get(panelId);
    if (ref) {
      try {
        ref.channel.postMessage(message);
      } catch {
        // Silently ignore
      }
    }
  }

  closePopOut(panelId: string): void {
    const ref = this.popoutWindows.get(panelId);
    if (ref) {
      if (ref.window && !ref.window.closed) {
        ref.window.close();
      }
      this.handlePopOutClosed(panelId);
    }
  }

  closeAllPopOuts(): void {
    this.popoutWindows.forEach((ref) => {
      if (ref.window && !ref.window.closed) {
        ref.window.close();
      }
    });
  }

  /**
   * Write a minimal HTML skeleton into the popout window.
   * Styles are copied separately AFTER portal attachment (see copyStylesToPopout).
   */
  private writePopoutDocument(popoutWindow: Window): void {
    const doc = popoutWindow.document;
    doc.open();
    doc.write('<!DOCTYPE html><html><head></head><body></body></html>');
    doc.close();

    doc.body.style.margin = '0';
    doc.body.style.overflow = 'hidden';
  }

  /**
   * Copy all stylesheets and inline styles from parent document to popout.
   * Must be called AFTER portal attachment so that Angular's component styles
   * (generated on first instantiation) are present in the parent's <head>.
   *
   * Handles three style source patterns:
   * 1. <link rel="stylesheet"> — cloned directly (external file reference)
   * 2. <style> with textContent — cloned directly (Angular component styles)
   * 3. <style> with CSSOM-only rules — serialized from sheet.cssRules
   *    (Plotly creates empty <style> elements and uses insertRule() to add CSS)
   */
  private copyStylesToPopout(popoutWindow: Window): void {
    const doc = popoutWindow.document;
    document.head.querySelectorAll('link[rel="stylesheet"], style').forEach(node => {
      doc.head.appendChild(this.cloneStyleNode(node, doc));
    });
  }

  /**
   * Clone a style node into a target document, preserving CSSOM-injected rules.
   *
   * importNode() only copies DOM content (textContent), not CSSOM rules added
   * via insertRule(). Libraries like Plotly create <style> elements with empty
   * textContent and inject rules programmatically — a naive clone loses them.
   */
  private cloneStyleNode(node: Node, targetDoc: Document): Node {
    if (node instanceof HTMLStyleElement && node.sheet) {
      try {
        const rules = node.sheet.cssRules;
        if (rules.length > 0 && !node.textContent?.trim()) {
          // CSSOM-only style element — serialize rules into text
          const style = targetDoc.createElement('style');
          // Preserve the id so Plotly's getElementById check finds it
          if (node.id) {
            style.id = node.id;
          }
          const cssText = Array.from(rules).map(r => r.cssText).join('\n');
          style.textContent = cssText;
          return style;
        }
      } catch {
        // CORS-restricted stylesheet — fall through to importNode
      }
    }
    return targetDoc.importNode(node, true);
  }

  /**
   * Watch for styles added to the parent <head> after initial copy.
   * Libraries like Plotly inject styles lazily at render time — after our
   * copyStylesToPopout() has already run.
   *
   * Also watches for CSSOM mutations: when a <style> element is added with
   * empty textContent, waits briefly for insertRule() calls to populate it,
   * then serializes the rules into the popout's copy.
   */
  private observeParentStyles(popoutWindow: Window): MutationObserver {
    const observer = new MutationObserver((mutations) => {
      if (popoutWindow.closed) {
        observer.disconnect();
        return;
      }
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof HTMLStyleElement || (node instanceof HTMLLinkElement && node.rel === 'stylesheet')) {
            if (node instanceof HTMLStyleElement && !node.textContent?.trim()) {
              // Likely a CSSOM-only element (e.g., Plotly) — defer to let insertRule() populate it
              setTimeout(() => {
                if (!popoutWindow.closed) {
                  popoutWindow.document.head.appendChild(
                    this.cloneStyleNode(node, popoutWindow.document)
                  );
                }
              }, 50);
            } else {
              popoutWindow.document.head.appendChild(
                this.cloneStyleNode(node, popoutWindow.document)
              );
            }
          }
        }
      }
    });

    observer.observe(document.head, { childList: true });
    return observer;
  }

  /**
   * Bridge event and DOM gaps between parent and popout windows.
   *
   * Three strategies work together:
   *
   * 1. **Drag cover reparenting**: Plotly creates a `.dragcover` overlay on the parent's
   *    `document.body`. We detect it via MutationObserver (primed by mousedown in the
   *    popout) and move it to the popout's body so it captures the cursor correctly.
   *
   * 2. **Mouse event forwarding**: Plotly binds `mousemove`/`mouseup` on the parent's
   *    `document`. After reparenting the dragCover, mouse events fire in the popout
   *    window — we forward them to the parent so Plotly's drag handlers run. Forwarding
   *    is active only during drags (mousedown→mouseup) to avoid interference.
   *
   * 3. **Keyboard forwarding**: Angular's `@HostListener('document:keydown')` binds to
   *    the parent's document. Key presses in the popout are forwarded.
   *
   * Returns an AbortController for cleanup.
   */
  private forwardDragEvents(popoutWindow: Window): AbortController {
    const controller = new AbortController();
    const { signal } = controller;

    let dragActive = false;
    let dragCoverObserver: MutationObserver | null = null;

    const handleDragCover = (node: HTMLElement) => {
      if (popoutWindow.closed || dragActive) return;

      // Move the dragCover to the popout's body.
      // Plotly's JS reference stays valid — cursor and visual overlay work in popout.
      popoutWindow.document.adoptNode(node);
      popoutWindow.document.body.appendChild(node);

      // Sync cursor immediately
      popoutWindow.document.body.style.cursor = document.body.style.cursor || 'crosshair';

      // Activate mouse event forwarding for this drag
      dragActive = true;

      // Stop observing — we found the dragCover
      if (dragCoverObserver) {
        dragCoverObserver.disconnect();
        dragCoverObserver = null;
      }
    };

    // --- Mousedown in popout: prime the drag cover observer ---
    // Only watch for .dragcover when a mousedown happens in this popout.
    // Uses capture phase to ensure we prime even if the chart stops propagation.
    popoutWindow.document.addEventListener('mousedown', () => {
      if (popoutWindow.closed) return;

      // Check for existing element (fast Plotly or already present)
      const existing = document.body.querySelector('.dragcover, .zoomedbox') as HTMLElement;
      if (existing) {
        handleDragCover(existing);
      }

      // Start observing parent body for .dragcover/zoomedbox additions
      dragCoverObserver = new MutationObserver((mutations) => {
        if (popoutWindow.closed) {
          dragCoverObserver?.disconnect();
          dragCoverObserver = null;
          return;
        }
        for (const mutation of mutations) {
          for (const node of Array.from(mutation.addedNodes)) {
            if (node instanceof HTMLElement &&
               (node.classList.contains('dragcover') || node.classList.contains('zoomedbox'))) {
              handleDragCover(node);
            }
          }
        }
      });

      dragCoverObserver.observe(document.body, { childList: true });

      // Safety: disconnect after 500ms if no dragCover appeared (wasn't a Plotly drag)
      setTimeout(() => {
        if (dragCoverObserver && !dragActive) {
          dragCoverObserver.disconnect();
          dragCoverObserver = null;
        }
      }, 500);
    }, { signal, capture: true });

    // --- Forward mouse events to parent document during active drags ---
    // Plotly's onMove/onDone are bound to parent's `document`. The reparented dragCover
    // captures events in the popout — we relay them to the parent.
    const mouseEvents = ['mousemove', 'mouseup', 'touchmove', 'touchend'] as const;

    for (const eventType of mouseEvents) {
      popoutWindow.document.addEventListener(eventType, (e: any) => {
        if (!dragActive) return;

        // Sync cursor during move (Plotly may update cursor on parent body)
        if (eventType === 'mousemove' || eventType === 'touchmove') {
          popoutWindow.document.body.style.cursor = document.body.style.cursor;
        }

        // Use parent constructors to avoid cross-window instance checks failing in Plotly.
        // e.g. Plotly (in parent) does `event instanceof MouseEvent` which fails if constructor
        // comes from popout window.
        const EventConstructor = (window as any)[e.constructor.name] || e.constructor;
        const forwarded = new EventConstructor(e.type, e);
        document.dispatchEvent(forwarded);

        // On mouseup/touchend: deactivate forwarding and reset cursor
        if (eventType === 'mouseup' || eventType === 'touchend') {
          dragActive = false;
          popoutWindow.document.body.style.cursor = '';
          document.body.style.cursor = '';
        }
      }, { signal });
    }

    // --- Forward keyboard events to parent document ---
    for (const eventType of ['keydown', 'keyup'] as const) {
      popoutWindow.document.addEventListener(eventType, (e: any) => {
        const EventConstructor = (window as any)[e.constructor.name] || e.constructor;
        const forwarded = new EventConstructor(e.type, e);
        document.dispatchEvent(forwarded);
      }, { signal });
    }

    return controller;
  }

  private handlePopOutClosed(panelId: string): void {
    const ref = this.popoutWindows.get(panelId);
    if (!ref) {
      return;
    }

    clearInterval(ref.checkInterval);

    // Stop watching for new styles
    if (ref.styleObserver) {
      ref.styleObserver.disconnect();
    }

    // Stop forwarding drag events
    if (ref.eventForwardingController) {
      ref.eventForwardingController.abort();
    }

    // Detach portal and clean up CDK outlet
    if (ref.outlet) {
      ref.outlet.detach();
      ref.outlet.dispose();
    }

    ref.channel.close();
    this.popoutWindows.delete(panelId);
    this.poppedOutPanels.delete(panelId);

    this.closedSubject.next(panelId);
  }

  ngOnDestroy(): void {
    window.removeEventListener('beforeunload', this.beforeUnloadHandler);

    this.popoutWindows.forEach((ref) => {
      clearInterval(ref.checkInterval);
      if (ref.styleObserver) {
        ref.styleObserver.disconnect();
      }
      if (ref.eventForwardingController) {
        ref.eventForwardingController.abort();
      }
      if (ref.outlet) {
        ref.outlet.detach();
        ref.outlet.dispose();
      }
      ref.channel.close();
      if (ref.window && !ref.window.closed) {
        ref.window.close();
      }
    });

    this.messagesSubject.complete();
    this.closedSubject.complete();
    this.blockedSubject.complete();
  }
}
