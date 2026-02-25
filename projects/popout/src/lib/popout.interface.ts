/**
 * Popout Library — Type Definitions
 *
 * Domain-agnostic types for portal-based pop-out window management.
 * No application-specific types — only window lifecycle and messaging.
 */

import { ComponentRef } from '@angular/core';
import { DomPortalOutlet } from '@angular/cdk/portal';

/**
 * Message passed between main window and pop-out via BroadcastChannel or @Output().
 */
export interface PopOutMessage<T = any> {
  type: PopOutMessageType;
  payload?: T;
  timestamp?: number;
}

/**
 * Message types for cross-window communication.
 *
 * The library defines a small, fixed set of structural message types.
 * Application-specific semantics are carried in COMPONENT_OUTPUT payloads.
 */
export enum PopOutMessageType {
  /** Main → Popout: full state push via BroadcastChannel */
  STATE_UPDATE = 'STATE_UPDATE',

  /** Main → Popout: request window close */
  CLOSE_POPOUT = 'CLOSE_POPOUT',

  /** Popout → Main: portal component emitted an @Output() event */
  COMPONENT_OUTPUT = 'COMPONENT_OUTPUT',

  /** Popout → Main: popout is ready to receive state (BroadcastChannel) */
  PANEL_READY = 'PANEL_READY',
}

/**
 * Tracked reference to an open pop-out window.
 */
export interface PopOutWindowRef {
  window: Window;
  channel: BroadcastChannel;
  checkInterval: number;
  panelId: string;
  panelType: string;
  outlet: DomPortalOutlet;
  componentRef: ComponentRef<any>;
  styleObserver: MutationObserver | null;
  eventForwardingController: AbortController | null;
}

/**
 * Window features for window.open().
 */
export interface PopOutWindowFeatures {
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  menubar?: boolean;
  toolbar?: boolean;
  location?: boolean;
  status?: boolean;
  resizable?: boolean;
  scrollbars?: boolean;
}

/**
 * Build a window.open() features string from a config object.
 */
export function buildWindowFeatures(features: PopOutWindowFeatures): string {
  const {
    width = 1200,
    height = 800,
    left = 100,
    top = 100,
    menubar = false,
    toolbar = false,
    location = false,
    status = false,
    resizable = true,
    scrollbars = true,
  } = features;

  const b = (val: boolean) => (val ? 'yes' : 'no');

  return [
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    `menubar=${b(menubar)}`,
    `toolbar=${b(toolbar)}`,
    `location=${b(location)}`,
    `status=${b(status)}`,
    `resizable=${b(resizable)}`,
    `scrollbars=${b(scrollbars)}`,
  ].join(',');
}
