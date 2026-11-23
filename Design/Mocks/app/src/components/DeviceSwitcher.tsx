import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { deviceNames, type Device } from './devices';

interface Global { device: Device; seq: number }
interface Ctx { global: Global; setAll: (d: Device) => void; bump: () => number }
const DeviceContext = createContext<Ctx | null>(null);

/**
 * Wrap a page that has several DeviceViews. The page-level switch sets all of
 * them at once; each view can still be changed on its own afterwards.
 */
export function DeviceProvider({ children }: { children: ReactNode }) {
  const seq = useRef(0);
  const [global, setGlobal] = useState<Global>({ device: 'iphone', seq: 0 });
  const ctx: Ctx = {
    global,
    setAll: (device) => setGlobal({ device, seq: ++seq.current }),
    bump: () => ++seq.current,
  };
  return <DeviceContext.Provider value={ctx}>{children}</DeviceContext.Provider>;
}

const all: Device[] = ['iphone', 'ipad', 'mac'];

export function DeviceSwitcher({ value, onChange, options = all, label }: {
  value: Device;
  onChange: (d: Device) => void;
  options?: Device[];
  label: string;
}) {
  return (
    <span className="switch" role="group" aria-label={label}>
      {options.map((d) => (
        <button key={d} className={d === value ? 'on' : ''} aria-pressed={d === value} onClick={() => onChange(d)}>
          {deviceNames[d]}
        </button>
      ))}
    </span>
  );
}

/** One switch that sets every view on the page. */
export function PageDeviceSwitch() {
  const ctx = useContext(DeviceContext);
  if (!ctx) return null;
  // Shows the last page-level choice only after one was made.
  const chosen = ctx.global.seq > 0 ? ctx.global.device : null;
  return (
    <div className="pageswitch">
      <span>All views on:</span>
      <span className="switch" role="group" aria-label="All views">
        {all.map((d) => (
          <button key={d} className={d === chosen ? 'on' : ''} aria-pressed={d === chosen} onClick={() => ctx.setAll(d)}>
            {deviceNames[d]}
          </button>
        ))}
      </span>
    </div>
  );
}

/**
 * A labelled view with its own iPhone / iPad / Mac switch. `render` draws the
 * view for the chosen device. Captions can differ per device.
 */
export function DeviceView({ label, caption, initial = 'iphone', options = all, render, wide }: {
  label: string;
  caption?: ReactNode | Partial<Record<Device, ReactNode>>;
  initial?: Device;
  options?: Device[];
  render: (d: Device) => ReactNode;
  wide?: boolean;
}) {
  const ctx = useContext(DeviceContext);
  const [local, setLocal] = useState<{ device: Device; seq: number }>({ device: initial, seq: 0 });
  const device = ctx && ctx.global.seq > local.seq ? ctx.global.device : local.device;
  const effective = options.includes(device) ? device : local.device;
  const pick = (d: Device) => setLocal({ device: d, seq: ctx ? ctx.bump() : 0 });
  const cap = caption && typeof caption === 'object' && !('$$typeof' in caption) ? (caption as Partial<Record<Device, ReactNode>>)[effective] : (caption as ReactNode);
  return (
    <figure className={`fig ${effective === 'iphone' && !wide ? 'w-phone' : 'w-wide'}`} style={effective === 'iphone' ? { width: 300 } : undefined}>
      <div className="figbar">
        <span className="lbl">{label}</span>
        <DeviceSwitcher value={effective} onChange={pick} options={options} label={`${label}: device`} />
      </div>
      <div className="stagebox">{render(effective)}</div>
      {cap && <figcaption>{cap}</figcaption>}
    </figure>
  );
}
