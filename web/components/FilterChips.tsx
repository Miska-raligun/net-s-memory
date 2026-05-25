"use client";

export interface ChipOption {
  value: string;
  label: string;
  count?: number;
}

export default function FilterChips({
  options,
  value,
  onChange,
}: {
  options: ChipOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="filter-chips" role="tablist">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`filter-chip${active ? " filter-chip-active" : ""}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
            {typeof opt.count === "number" && (
              <span className="filter-chip-count">{opt.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
