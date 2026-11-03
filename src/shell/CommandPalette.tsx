import { useEffect, useMemo, useRef, useState } from 'react';
import { SECTIONS, navigate } from '../app/routes';
import type { SectionId, TwinModule } from '../app/routes';
import { NavIcon } from './NavIcons';

interface Command {
  id: string;
  label: string;
  hint: string;
  icon: SectionId;
  run: () => void;
}

const TWINS: { module: TwinModule; label: string }[] = [
  { module: 'brake-caliper', label: 'Brake Caliper' },
  { module: 'spark-plug', label: 'Spark Plug' },
  { module: 'alloy-wheel', label: 'Alloy Wheel' },
];

/**
 * Ctrl/Cmd+K command palette. Only offers navigation that already exists:
 * every section in SECTIONS plus the three Digital Twin modules, and the
 * sidebar toggle. Esc closes it; arrows + Enter pick.
 */
export function CommandPalette({ onToggleRail }: { onToggleRail: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = SECTIONS.map((s) => ({
      id: `go-${s.id}`,
      label: s.label,
      hint: 'Go to page',
      icon: s.id,
      run: () => navigate({ section: s.id }),
    }));
    if (SECTIONS.some((s) => s.id === 'digital-twin')) {
      for (const t of TWINS) {
        list.push({
          id: `twin-${t.module}`,
          label: `${t.label} twin`,
          hint: 'Digital Twin',
          icon: 'digital-twin',
          run: () => navigate({ section: 'digital-twin', module: t.module }),
        });
      }
    }
    list.push({ id: 'rail', label: 'Collapse / expand sidebar', hint: 'Ctrl+B', icon: 'dashboard', run: onToggleRail });
    return list;
  }, [onToggleRail]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? commands.filter((c) => `${c.label} ${c.hint}`.toLowerCase().includes(t)) : commands;
  }, [commands, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => {
          if (!o) restoreRef.current = document.activeElement as HTMLElement | null;
          return !o;
        });
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        onToggleRail();
      }
    };
    window.addEventListener('keydown', onKey);
    const onOpen = () => {
      restoreRef.current = document.activeElement as HTMLElement | null;
      setOpen(true);
    };
    window.addEventListener('autotwin:palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('autotwin:palette', onOpen);
    };
  }, [onToggleRail]);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      restoreRef.current?.focus?.();
    }
  }, [open]);

  if (!open) return null;

  const pick = (c: Command | undefined) => {
    if (!c) return;
    setOpen(false);
    c.run();
  };

  return (
    <div className="at-palette-scrim" onMouseDown={() => setOpen(false)}>
      <div
        className="at-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="at-palette-input"
          placeholder="Jump to a page or twin…"
          value={q}
          aria-label="Search commands"
          aria-controls="at-palette-list"
          aria-activedescendant={filtered[sel] ? `cmd-${filtered[sel].id}` : undefined}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(filtered.length - 1, s + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === 'Enter') pick(filtered[sel]);
          }}
        />
        <ul className="at-palette-list" id="at-palette-list" role="listbox">
          {filtered.length === 0 && <li className="at-palette-empty">No matching page.</li>}
          {filtered.map((c, i) => (
            <li
              key={c.id}
              id={`cmd-${c.id}`}
              role="option"
              aria-selected={i === sel}
              className={i === sel ? 'sel' : ''}
              onMouseEnter={() => setSel(i)}
              onClick={() => pick(c)}
            >
              <NavIcon id={c.icon} />
              <span className="l">{c.label}</span>
              <span className="h">{c.hint}</span>
            </li>
          ))}
        </ul>
        <div className="at-palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>Enter</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
