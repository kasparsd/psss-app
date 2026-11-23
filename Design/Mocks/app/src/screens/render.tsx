import type { ReactNode } from 'react';
import { IPad, MacWindow, type Device } from '../components/devices';
import { Workspace, type WorkspaceInit } from '../components/Workspace';

/**
 * Draw the Mac / iPad workspace in its device frame, or the given iPhone
 * screen. Every multi-device view goes through this, so a change to the
 * workspace shows up on every page.
 */
export function renderDevice(device: Device, phone: ReactNode, init?: WorkspaceInit, opts: { menuBar?: boolean; empty?: boolean } = {}): ReactNode {
  const pill = init?.copied ? `${init.copied} copied` : undefined;
  if (device === 'iphone') return phone;
  if (device === 'ipad') return <IPad pill={pill}><Workspace device="ipad" init={init} empty={opts.empty} /></IPad>;
  return <MacWindow pill={pill} menuBar={opts.menuBar} menuOpen={init?.menu}><Workspace device="mac" init={init} empty={opts.empty} /></MacWindow>;
}
