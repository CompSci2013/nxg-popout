/**
 * Pop-out Orchestrator Service
 *
 * Thin coordination layer over PopOutManagerService that reduces consumer
 * boilerplate for the common pattern: register popout-able components,
 * toggle them open/closed, react to close events, sync data.
 *
 * Consumers provide this per-component (like PopOutManagerService) and
 * interact through register(), toggle(), and a single closed$ observable.
 *
 * The orchestrator owns:
 *   - Component type registry (popoutId → component class)
 *   - Toggle logic (open if closed, close if open)
 *   - Automatic cleanup on destroy
 *   - Closed event relay
 *
 * The consumer owns:
 *   - What data to pass on toggle (domain-specific)
 *   - When to call syncInputs() for live updates
 *   - What to do when a popout closes (re-show inline, etc.)
 */

import {
  Injectable,
  Injector,
  OnDestroy,
  Type
} from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { PopOutManagerService } from './popout-manager.service';
import { PopOutMessage, PopOutWindowFeatures } from './popout.interface';

export interface PopoutRegistration {
  componentType: Type<any>;
  defaultFeatures?: Partial<PopOutWindowFeatures>;
}

@Injectable()
export class PopOutOrchestrator implements OnDestroy {
  private registry = new Map<string, PopoutRegistration>();
  private closedSubject = new Subject<string>();
  private messagesSubject = new Subject<{ popoutId: string; message: PopOutMessage }>();
  private subscriptions: Subscription[] = [];
  private initialized = false;

  /** Emits the popoutId when a popout window is closed. */
  readonly closed$ = this.closedSubject.asObservable();

  /** Relays all messages from popout windows. */
  readonly messages$ = this.messagesSubject.asObservable();

  constructor(private manager: PopOutManagerService) {}

  /**
   * Register a component that can be popped out.
   *
   * Call once per popout-able component, typically in ngOnInit.
   * Does not open anything — just records the mapping.
   *
   * @param popoutId - Unique identifier for this popout slot
   * @param componentType - Angular component class to render in the popout
   * @param defaultFeatures - Optional default window size/position
   */
  register(popoutId: string, componentType: Type<any>, defaultFeatures?: Partial<PopOutWindowFeatures>): void {
    this.registry.set(popoutId, { componentType, defaultFeatures });
  }

  /**
   * Initialize the orchestrator. Call once from the host component's ngOnInit.
   *
   * @param hostInjector - The host component's Injector, so portal-rendered
   *   components inherit the host's DI context (shared services, etc.)
   */
  initialize(hostInjector: Injector): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    this.manager.initialize(hostInjector);

    this.subscriptions.push(
      this.manager.closed$.subscribe(popoutId => {
        this.closedSubject.next(popoutId);
      }),
      this.manager.messages$.subscribe(msg => {
        this.messagesSubject.next(msg);
      })
    );
  }

  /**
   * Toggle a popout open or closed.
   *
   * If the popout is currently closed, opens it with the given data.
   * If the popout is currently open, closes it.
   *
   * @param popoutId - Must match a previously registered ID
   * @param data - Key/value pairs set on the component instance (@Input values)
   * @param features - Optional window features override (merged with registration defaults)
   * @returns true if a popout was opened, false if it was closed or the ID is unregistered
   */
  toggle(popoutId: string, data: Record<string, any> = {}, features?: Partial<PopOutWindowFeatures>): boolean {
    if (this.manager.isPoppedOut(popoutId)) {
      this.manager.closePopOut(popoutId);
      return false;
    }

    const registration = this.registry.get(popoutId);
    if (!registration) {
      console.warn(`[PopOutOrchestrator] No registration for popoutId "${popoutId}". Call register() first.`);
      return false;
    }

    const mergedFeatures = { ...registration.defaultFeatures, ...features };
    return this.manager.openPopOut(popoutId, registration.componentType, data, mergedFeatures);
  }

  /**
   * Check if a popout is currently open.
   */
  isOpen(popoutId: string): boolean {
    return this.manager.isPoppedOut(popoutId);
  }

  /**
   * Get all currently open popout IDs.
   */
  getOpenPopouts(): string[] {
    return this.manager.getPoppedOutPanels();
  }

  /**
   * Update @Input properties on an open popout component.
   *
   * Simulates Angular template binding: sets properties, builds SimpleChanges,
   * calls ngOnChanges, runs detectChanges. No-op if the popout isn't open.
   *
   * @param popoutId - The popout to update
   * @param inputs - Key/value pairs to set on the component instance
   */
  syncInputs(popoutId: string, inputs: Record<string, any>): void {
    if (this.manager.isPoppedOut(popoutId)) {
      this.manager.setPopoutInputs(popoutId, inputs);
    }
  }

  /**
   * Broadcast state to all open popouts and trigger change detection.
   *
   * Use when shared services have updated and all popouts need a CD kick,
   * or when pushing state via BroadcastChannel.
   */
  broadcast(state: any, extra?: any): void {
    this.manager.broadcastState(state, extra);
  }

  /**
   * Close a specific popout.
   */
  close(popoutId: string): void {
    this.manager.closePopOut(popoutId);
  }

  /**
   * Close all open popouts.
   */
  closeAll(): void {
    this.manager.closeAllPopOuts();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
    this.closedSubject.complete();
    this.messagesSubject.complete();
    // PopOutManagerService handles its own cleanup via its own ngOnDestroy
  }
}
