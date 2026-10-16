// Building blocks for the admin settings screens. Every tab composes these
// instead of bespoke markup so the whole area shares one look and collapses
// to a single, touch-friendly column on phones. Styles live in styles/admin.css.
import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { ChevronRight, Eye, EyeOff, Loader2, Search, type LucideIcon } from "lucide-react";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

/* ── Panel: the card every section is built from ─────────────────────────── */

interface PanelProps {
  title?: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  children?: ReactNode;
  /** Remove body padding (for lists that run edge to edge). */
  flush?: boolean;
  tone?: Tone;
  className?: string;
  id?: string;
}

export function Panel({ title, description, icon: Icon, actions, children, flush, tone, className, id }: PanelProps) {
  const hasHead = title || description || actions;
  return (
    <section id={id} className={cx("as-panel", tone && tone !== "neutral" && `as-panel-${tone}`, className)}>
      {hasHead && (
        <header className="as-panel-head">
          <div className="as-panel-heading">
            {title && (
              <h3 className="as-panel-title">
                {Icon && <Icon size={16} aria-hidden="true" />}
                {title}
              </h3>
            )}
            {description && <p className="as-panel-desc">{description}</p>}
          </div>
          {actions && <div className="as-panel-actions">{actions}</div>}
        </header>
      )}
      {children !== undefined && children !== null && (
        <div className={cx("as-panel-body", flush && "as-panel-body-flush")}>{children}</div>
      )}
    </section>
  );
}

export function Stack({ children, gap = "md", className }: { children: ReactNode; gap?: "sm" | "md" | "lg"; className?: string }) {
  return <div className={cx("as-stack", `as-stack-${gap}`, className)}>{children}</div>;
}

/** Two columns on wide screens, one on phones. */
export function Columns({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("as-columns", className)}>{children}</div>;
}

/* ── Forms ──────────────────────────────────────────────────────────────── */

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  /** Span the full row of a FormGrid. */
  wide?: boolean;
}

export function Field({ label, hint, htmlFor, children, wide }: FieldProps) {
  return (
    <div className={cx("as-field", wide && "as-field-wide")}>
      <label className="as-field-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="as-field-hint">{hint}</p>}
    </div>
  );
}

/** Responsive form grid: one column on phones, auto-fit columns above. */
export function FormGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("as-form-grid", className)}>{children}</div>;
}

/** Row of buttons. Buttons stretch to full width on phones. */
export function Actions({ children, align = "end", className }: { children: ReactNode; align?: "start" | "end" | "between"; className?: string }) {
  return <div className={cx("as-actions", `as-actions-${align}`, className)}>{children}</div>;
}

/** Password input with a show/hide toggle. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <input {...props} type={visible ? "text" : "password"} className={cx("form-control password-input", props.className)} />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

/** Search input with a leading icon. */
export function SearchInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <div className="as-search">
      <Search size={16} aria-hidden="true" />
      <input {...props} type="search" className={cx("form-control", props.className)} />
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface AdminButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: LucideIcon;
  loading?: boolean;
  size?: "sm" | "md";
  /** Icon-only button; pass an aria-label. */
  iconOnly?: boolean;
}

export function Button({
  variant = "secondary",
  icon: Icon,
  loading,
  size = "md",
  iconOnly,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: AdminButtonProps) {
  const iconSize = size === "sm" ? 14 : 16;
  return (
    <button
      type={type}
      className={cx("as-btn", `as-btn-${variant}`, size === "sm" && "as-btn-sm", iconOnly && "as-btn-icon", className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={iconSize} className="animate-spin" aria-hidden="true" /> : Icon ? <Icon size={iconSize} aria-hidden="true" /> : null}
      {!iconOnly && children}
    </button>
  );
}

interface ToggleProps {
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

/** A full-row switch: the whole row is the tap target. */
export function ToggleRow({ title, description, checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="as-toggle-row"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="as-toggle-text">
        <span className="as-toggle-title">{title}</span>
        {description && <span className="as-toggle-desc">{description}</span>}
      </span>
      <span className={cx("as-switch", checked && "as-switch-on")} aria-hidden="true">
        <span className="as-switch-thumb" />
      </span>
    </button>
  );
}

/* ── Data display ───────────────────────────────────────────────────────── */

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="as-stat-grid">{children}</div>;
}

interface StatProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
}

export function Stat({ label, value, sub, icon: Icon, tone = "neutral" }: StatProps) {
  return (
    <div className={cx("as-stat", `as-stat-${tone}`)}>
      <div className="as-stat-top">
        <span className="as-stat-label">{label}</span>
        {Icon && <Icon size={15} aria-hidden="true" />}
      </div>
      <div className="as-stat-value">{value}</div>
      {sub && <div className="as-stat-sub">{sub}</div>}
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("as-badge", `as-badge-${tone}`)}>{children}</span>;
}

export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cx("as-list", className)}>{children}</ul>;
}

interface ListItemProps {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  /** Extra content under the row (controls, details). */
  children?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  chevron?: boolean;
}

export function ListItem({ leading, title, subtitle, meta, trailing, children, onClick, selected, chevron }: ListItemProps) {
  const main = (
    <>
      {leading && <span className="as-item-leading">{leading}</span>}
      <span className="as-item-main">
        <span className="as-item-title">{title}</span>
        {subtitle && <span className="as-item-subtitle">{subtitle}</span>}
        {meta && <span className="as-item-meta">{meta}</span>}
      </span>
      {trailing && <span className="as-item-trailing">{trailing}</span>}
      {chevron && <ChevronRight size={16} className="as-item-chevron" aria-hidden="true" />}
    </>
  );
  return (
    <li className={cx("as-item", selected && "as-item-selected")}>
      {onClick ? (
        <button type="button" className="as-item-row as-item-row-button" onClick={onClick}>{main}</button>
      ) : (
        <div className="as-item-row">{main}</div>
      )}
      {children && <div className="as-item-extra">{children}</div>}
    </li>
  );
}

export function Avatar({ name, tone = "accent" }: { name: string; tone?: Tone }) {
  return <span className={cx("as-avatar", `as-avatar-${tone}`)} aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span>;
}

/** Label/value pairs; stacks label above value on phones. */
export function KeyValues({ items }: { items: Array<{ label: ReactNode; value: ReactNode; mono?: boolean }> }) {
  return (
    <dl className="as-kv">
      {items.map((item, index) => (
        <div key={index} className="as-kv-row">
          <dt>{item.label}</dt>
          <dd className={item.mono ? "as-mono" : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Progress({ value, tone = "accent", label }: { value: number; tone?: Tone; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cx("as-progress", `as-progress-${tone}`)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

interface EmptyProps {
  icon?: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, children, action }: EmptyProps) {
  return (
    <div className="as-empty">
      {Icon && <Icon size={22} aria-hidden="true" />}
      <p className="as-empty-title">{title}</p>
      {children && <p className="as-empty-desc">{children}</p>}
      {action}
    </div>
  );
}

export function Notice({ tone = "accent", icon: Icon, children }: { tone?: Tone; icon?: LucideIcon; children: ReactNode }) {
  return (
    <div className={cx("as-notice", `as-notice-${tone}`)} role={tone === "danger" ? "alert" : undefined}>
      {Icon && <Icon size={16} aria-hidden="true" />}
      <div>{children}</div>
    </div>
  );
}

/* ── Filtering ──────────────────────────────────────────────────────────── */

/** Search + filters bar; the search stretches full width on phones. */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("as-toolbar", className)}>{children}</div>;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode; count?: number }>;
  label: string;
}

/** Horizontally scrollable chip filter. */
export function Segmented<T extends string>({ value, onChange, options, label }: SegmentedProps<T>) {
  return (
    <div className="as-segmented" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={cx("as-chip", value === option.value && "as-chip-active")}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && <span className="as-chip-count">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}
