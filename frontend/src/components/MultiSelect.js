import React, { useState, useEffect, useRef } from 'react';

/**
 * Dropdown with checkboxes for picking any number of options. Nothing selected means "all".
 *
 * @param {string} id
 * @param {{ value: string, label: string, hint?: string }[]} options
 * @param {string[]} selected
 * @param {(values: string[]) => void} onChange
 * @param {string} allLabel  shown when nothing is selected, e.g. "All Projects"
 */
const MultiSelect = ({ id, options, selected, onChange, allLabel }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const toggle = (value) => {
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value]);
  };

  const visibleOptions = options.filter(option =>
    !search || option.label.toLowerCase().includes(search.toLowerCase())
  );

  const labelFor = (value) => options.find(option => option.value === value)?.label || value;

  const summary = selected.length === 0
    ? allLabel
    : selected.length === 1
      ? labelFor(selected[0])
      : `${selected.length} selected`;

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 px-3 py-2 border rounded-md shadow-sm bg-white text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${selected.length ? 'border-blue-400' : 'border-gray-300'}`}
      >
        <span className={`truncate ${selected.length ? 'text-gray-900 font-medium' : 'text-gray-700'}`}>{summary}</span>
        <span className="flex items-center gap-1 flex-shrink-0">
          {selected.length > 0 && (
            <span className="px-1.5 rounded-full bg-blue-100 text-blue-800 text-xs font-medium">{selected.length}</span>
          )}
          <svg className={`w-4 h-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[16rem] bg-white border border-gray-200 rounded-md shadow-lg">
          {options.length > 6 && (
            <div className="p-2 border-b border-gray-100">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                placeholder="Search..."
                className="block w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 text-xs">
            <button
              type="button"
              onClick={() => onChange([...new Set([...selected, ...visibleOptions.map(option => option.value)])])}
              className="text-blue-600 hover:underline"
            >
              Select {search ? 'matching' : 'all'}
            </button>
            <button type="button" onClick={() => onChange([])} disabled={selected.length === 0} className="text-gray-600 hover:underline disabled:opacity-40">
              Clear
            </button>
          </div>
          <ul role="listbox" aria-multiselectable="true" className="max-h-64 overflow-y-auto py-1">
            {visibleOptions.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">No matches</li>}
            {visibleOptions.map(option => {
              const checked = selected.includes(option.value);
              return (
                <li key={option.value} role="option" aria-selected={checked}>
                  <label className="flex items-start gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(option.value)}
                      className="mt-0.5 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm text-gray-900 break-words">{option.label}</span>
                      {option.hint && <span className="block text-xs text-gray-500">{option.hint}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {selected.length > 1 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {selected.map(value => (
            <span key={value} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-blue-50 text-blue-800 text-xs">
              <span className="truncate max-w-[10rem]">{labelFor(value)}</span>
              <button
                type="button"
                onClick={() => toggle(value)}
                className="rounded-full hover:bg-blue-200 px-1"
                aria-label={`Remove ${labelFor(value)}`}
                data-html2canvas-ignore="true"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default MultiSelect;
