import { NgModule } from '@angular/core';
import { PortalModule } from '@angular/cdk/portal';

@NgModule({
  imports: [
    PortalModule
  ],
  exports: [
    PortalModule
  ]
})
export class PopoutModule {}
