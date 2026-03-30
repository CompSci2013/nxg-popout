# @halolabs/ngx-popout

Angular CDK portal-based pop-out window manager. Opens `about:blank` windows and renders Angular components into them via `DomPortalOutlet` — no full app bootstrap, no router, no auth guards.

**Angular 14.2** | **RxJS 7** | **Angular CDK required**

## Installation

This library is published to a private GitLab npm registry. See [PUBLISHING.md](PUBLISHING.md) for full setup.

### Consumer `.npmrc`

Create `.npmrc` in your project root:

```
@halolabs:registry=http://gitlab.minilab/api/v4/groups/7/-/packages/npm/
//gitlab.minilab/api/v4/groups/7/-/packages/npm/:_authToken=YOUR_PAT_TOKEN
```

### Install

```bash
npm install @halolabs/ngx-popout
```

## Usage

### Module setup

```typescript
import { PopoutModule, PopOutManagerService } from '@halolabs/ngx-popout';

@NgModule({
  imports: [PopoutModule],
  providers: [PopOutManagerService]
})
export class MyModule {}
```

### Opening a pop-out

```typescript
@Component({ ... })
export class MyComponent implements OnInit, OnDestroy {
  constructor(private popOutManager: PopOutManagerService) {}

  ngOnInit() {
    this.popOutManager.initialize(this.injector);
  }

  openChart() {
    this.popOutManager.openPopOut(
      'chart-1',              // unique panel ID
      ChartComponent,         // component to render
      { title: 'My Chart', data: this.chartData },  // @Input() values
      { width: 1400, height: 900 }                   // window features
    );
  }

  ngOnDestroy() {
    this.popOutManager.closeAllPopOuts();
  }
}
```

### Updating pop-out inputs

Portal-rendered components don't have a parent template re-evaluating bindings. Use `setPopoutInputs` to push changes and trigger `ngOnChanges`:

```typescript
this.popOutManager.setPopoutInputs('chart-1', {
  data: newData,
  title: 'Updated Chart'
});
```

### Listening for pop-out events

All `@Output()` EventEmitters on the portal component are auto-wired as messages:

```typescript
this.popOutManager.messages$.subscribe(({ popoutId, message }) => {
  if (message.type === PopOutMessageType.COMPONENT_OUTPUT) {
    const { outputName, data } = message.payload;
    // Handle component output
  }
});

this.popOutManager.closed$.subscribe(popoutId => {
  // Pop-out window was closed
});
```

### Pop-out context detection

Components can detect when they're rendered in a pop-out and wait for the environment to stabilize (styles copied, event forwarding active):

```typescript
constructor(@Optional() private popOutContext: PopOutContextService) {
  if (this.popOutContext) {
    this.popOutContext.ready$.subscribe(() => {
      // Safe to re-initialize DOM-dependent libraries (e.g. Plotly.newPlot)
    });
  }
}
```

## Orchestrator (Recommended)

For most use cases, use `PopOutOrchestrator` instead of `PopOutManagerService` directly. It eliminates toggle logic, close subscription management, and cleanup boilerplate.

### Setup

```typescript
import { PopoutModule, PopOutOrchestrator, PopOutManagerService } from '@halolabs/ngx-popout';

@NgModule({
  imports: [PopoutModule],
  // PopOutManagerService and PopOutOrchestrator are provided per-component, not here
})
export class MyModule {}
```

### Consumer component

```typescript
@Component({
  selector: 'app-search-page',
  providers: [PopOutManagerService, PopOutOrchestrator],
  template: `
    <app-results-table *ngIf="!popouts.isOpen('results')" [data]="results">
    </app-results-table>

    <button (click)="popouts.toggle('results', { data: results, title: 'Search Results' })">
      {{ popouts.isOpen('results') ? 'Pop In' : 'Pop Out' }} Results
    </button>
  `
})
export class SearchPageComponent implements OnInit, OnDestroy {
  results: any[] = [];

  constructor(
    public popouts: PopOutOrchestrator,
    private injector: Injector
  ) {}

  ngOnInit() {
    this.popouts.register('results', ResultsTablePopout, { width: 1400, height: 900 });
    this.popouts.register('chart', ChartPopout);
    this.popouts.initialize(this.injector);

    this.popouts.closed$.subscribe(popoutId => {
      // Popout was closed — component re-appears inline via *ngIf
    });
  }

  // When data changes, sync to any open popouts
  onDataUpdate(newResults: any[]) {
    this.results = newResults;
    this.popouts.syncInputs('results', { data: newResults });
  }

  ngOnDestroy() {
    // Orchestrator handles cleanup automatically
  }
}
```

### Orchestrator API

| Method | Description |
|--------|-------------|
| `register(popoutId, componentType, defaultFeatures?)` | Register a popout-able component. Call in ngOnInit. |
| `initialize(hostInjector)` | Initialize once. Portal components inherit this injector's DI context. |
| `toggle(popoutId, data?, features?)` | Open if closed, close if open. Returns true if opened. |
| `isOpen(popoutId)` | Check if a popout is currently open. |
| `getOpenPopouts()` | List all currently open popout IDs. |
| `syncInputs(popoutId, inputs)` | Update @Input properties on an open popout (triggers ngOnChanges + CD). |
| `broadcast(state, extra?)` | Push state to all popouts via BroadcastChannel + trigger CD. |
| `close(popoutId)` | Close a specific popout. |
| `closeAll()` | Close all open popouts. |

| Observable | Description |
|------------|-------------|
| `closed$` | Emits popoutId when a popout window is closed. |
| `messages$` | All messages from popout windows (component @Output events + BroadcastChannel). |

---

## Low-Level API

For advanced use cases where the orchestrator doesn't provide enough control, use `PopOutManagerService` directly.

### PopOutManagerService

| Method | Description |
|--------|-------------|
| `initialize(hostInjector?)` | Call once from host component. Portal components inherit this injector's DI context. |
| `openPopOut(popoutId, componentType, data, features?)` | Open a pop-out window and render a component. Returns `true` on success. |
| `setPopoutInputs(popoutId, inputs)` | Set `@Input()` properties, trigger `ngOnChanges`, and run change detection. |
| `updatePopoutData(popoutId, key, value)` | Set a single property on the component instance. |
| `broadcastState(state, extra?)` | Broadcast state via BroadcastChannel and trigger CD on all pop-outs. |
| `sendToPopout(popoutId, message)` | Send a message to a specific pop-out via BroadcastChannel. |
| `closePopOut(popoutId)` | Close a specific pop-out. |
| `closeAllPopOuts()` | Close all pop-outs. |
| `isPoppedOut(popoutId)` | Check if a panel is currently popped out. |
| `getPoppedOutPanels()` | Get list of all popped-out panel IDs. |

### Observables

| Observable | Description |
|------------|-------------|
| `messages$` | All messages from pop-out windows (BroadcastChannel + component outputs). |
| `closed$` | Emits panel ID when a pop-out is closed. |
| `blocked$` | Emits panel ID when a pop-out was blocked by the browser. |

### PopOutContextService

Injected into portal-rendered components via `@Optional()`.

| Member | Description |
|--------|-------------|
| `isPopOut: boolean` | Always `true` — confirms this component is in a pop-out. |
| `ready$: Observable<void>` | Emits once after styles are copied and event forwarding is active. |

## Features

- **Style synchronization**: Copies all parent styles (including CSSOM-injected rules from libraries like Plotly) and watches for late additions.
- **Drag event forwarding**: Reparents Plotly's `.dragcover` overlay and forwards mouse/touch events so drag interactions work correctly in pop-outs.
- **Keyboard forwarding**: Forwards `keydown`/`keyup` to the parent document so `@HostListener('document:keydown')` works.
- **Auto-wired outputs**: All `@Output()` EventEmitters on the portal component are automatically subscribed and relayed as messages.
- **Change detection**: `setPopoutInputs` simulates Angular template binding by building `SimpleChanges` and calling `ngOnChanges`.

## Peer Dependencies

- `@angular/core` ^14.2.0
- `@angular/common` ^14.2.0
- `@angular/cdk` ^14.2.0
- `rxjs` ^7.0.0
