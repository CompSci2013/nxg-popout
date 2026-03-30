# Consumer Complexity: Three Approaches to Popout

| Aspect | GoldenLayout v2 | Dockview | ngx-popout (ours) |
|--------|-----------------|----------|-------------------|
| **Popout mechanism** | `window.open()` to same URL, full Angular re-bootstrap | DOM transplantation — moves actual DOM node to popout | CDK Portal — renders component into `about:blank` window |
| **Consumer boilerplate** | ~300+ lines (base directive, component service, host component, per-component adaptations) | ~10 lines (static HTML file + one API call) | ~30 lines (provide service, initialize, toggle, subscribe closed$) |
| **State sync** | **DIY** — each popout is independent Angular app. Only raw `userBroadcast` string channel provided. You build everything else. | **Free** — DOM transplant means component never left, shared services keep working | **Semi-manual** — shared DI context works automatically, but OnPush needs `broadcastState()` or `setPopoutInputs()` |
| **Style handling** | Same URL loads same bundles, but dynamic styles (CDK overlays, Material) break. ViewEncapsulation attributes differ across windows. | Automatic — copies all stylesheets | Manual but thorough — copies styles + MutationObserver for late injections + CSSOM rule serialization |
| **Angular wrapper** | None worth using (community wrappers abandoned) | Official React support, Angular is "use dockview-core directly" | Native Angular library |
| **Lock-in** | Must use GL's entire layout system | Must use Dockview's layout system | **None** — works with any Angular component |
| **Per-component cost** | Each must extend `BaseComponentDirective`, inject container token, handle state serialization | Zero — just register a panel | Zero — pass any component class to `openPopOut()` |

## Honest Assessment

**GoldenLayout is the most complex by far.** Every popout bootstraps the entire Angular application from scratch. There's no shared state, no shared services, no shared injector across windows. The official Angular example requires ~300 lines of integration glue, and state sync is entirely your problem. The `ComponentFactoryResolver` pattern in their examples is deprecated since Angular 13.

**Dockview is the simplest** — but only if you're already using Dockview for your layout. One API call and DOM physically moves. Zero state sync needed. But you can't pop out arbitrary components — only Dockview panels.

**ngx-popout sits in between.** More boilerplate than Dockview (~30 lines vs ~10), but no layout library lock-in. Less boilerplate than GoldenLayout (~30 lines vs ~300+), and the shared DI context means services work automatically. The manual parts (style copying, event forwarding, change detection kicks) are complexity the library absorbs — the consumer doesn't write that code.

The orchestrator pattern we discussed would bring ngx-popout's consumer boilerplate closer to Dockview's simplicity (~10-15 lines) while keeping the "any component, no layout library" flexibility.
