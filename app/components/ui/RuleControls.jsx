import {useEffect, useRef} from 'react';

const focus = event => { event.currentTarget.style.outlineColor = '#6d28d9'; };
const blur = event => { event.currentTarget.style.outlineColor = 'transparent'; };
const controlStyle = {border: 0, background: 'transparent', borderRadius: 4, padding: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', outline: '2px solid transparent', outlineOffset: 2, color: 'inherit', font: 'inherit'};

export function RuleAction({label, disabled, href, onClick, children, style, title}) {
  const props = {'aria-label': label, title, onFocus: focus, onBlur: blur, style: {...controlStyle, ...style}};
  if (href) return <a {...props} href={href} aria-disabled={disabled || undefined} onClick={event => {
    if (disabled) {event.preventDefault();return;}
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {event.preventDefault();onClick(event);}
  }}>{children}</a>;
  return <button {...props} type="button" disabled={disabled} onClick={onClick}>{children}</button>;
}

export function RuleStatusSwitch({name, checked, disabled, onChange}) {
  return <span style={{display: 'inline-flex', alignItems: 'center', gap: 8}}>
    <button type="button" role="switch" aria-label={`Status for ${name}`} aria-checked={checked} disabled={disabled} aria-busy={disabled || undefined} onClick={onChange} onFocus={focus} onBlur={blur}
      style={{...controlStyle, padding: 0, width: 40, height: 24, position: 'relative', borderRadius: 12, background: checked ? '#5B21B6' : '#c4b5d5', opacity: disabled ? 0.7 : 1}}>
      <span aria-hidden="true" style={{width: 18, height: 18, position: 'absolute', left: checked ? 19 : 3, top: 3, borderRadius: '50%', background: '#fff'}} />
    </button><span style={{fontSize: 12}}>{checked ? 'Enabled' : 'Disabled'}</span>
  </span>;
}

export function RuleDialog({label, onCancel, children, ...props}) {
  const ref = useRef(null), cancel = useRef(onCancel);cancel.current = onCancel;
  useEffect(() => {
    const previous = document.activeElement, root = ref.current;
    (root.querySelector('button:not(:disabled)') || root).focus();
    return () => {if (previous?.isConnected) previous.focus();};
  }, []);
  return <div {...props} ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={event => {
    if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();cancel.current();}
    if (event.key !== 'Tab') return;
    const controls = [...ref.current.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(node => node.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (!first) {event.preventDefault();return;}
    if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {event.preventDefault();last.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
  }}>{children}</div>;
}
