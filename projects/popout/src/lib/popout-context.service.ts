/**
 * Pop-out Context Service
 *
 * Lightweight side-car service provided to portal-rendered components
 * via Injector.create in PopOutManagerService.
 *
 * Components that need to re-initialize after being moved to a pop-out
 * window (e.g. Plotly charts) can @Optional() inject this service and
 * subscribe to ready$ to know when the pop-out environment is stable
 * (styles copied, event forwarding active).
 *
 * Components rendered in the main window will not have this service
 * injected (it's only provided to portal components), so always use
 * @Optional() @Inject(PopOutContextService).
 */

import { Injectable } from '@angular/core';
import { ReplaySubject } from 'rxjs';

@Injectable()
export class PopOutContextService {
  /** True when this component is rendered in a pop-out window. */
  readonly isPopOut = true;

  /**
   * Emits once after the pop-out window is fully set up:
   * styles copied, event forwarding active, DOM stable.
   *
   * Components should subscribe and re-trigger any DOM-dependent
   * initialization (e.g. Plotly.newPlot) when this fires.
   */
  readonly ready$ = new ReplaySubject<void>(1);

  /** Called by PopOutManagerService after window setup is complete. */
  signalReady(): void {
    this.ready$.next();
    this.ready$.complete();
  }
}
