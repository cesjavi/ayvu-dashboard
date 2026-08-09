import { useState, useEffect, useRef, type FormEvent } from "react";
import { X, HelpCircle } from "lucide-react";

interface ProjectParam {
  id: string;
  name: string;
  label: string;
  description: string;
  required: boolean;
  agent_name: string;
}

interface RunParamsModalProps {
  params: ProjectParam[];
  onRun: (values: Record<string, string>) => void;
  onClose: () => void;
  loading: boolean;
}

export default function RunParamsModal({
  params,
  onRun,
  onClose,
  loading,
}: RunParamsModalProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of params) init[p.name] = "";
    return init;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Focus trap + Escape handler
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Focus first input on open
    firstInputRef.current?.focus();

    const focusableSelector =
      'button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "Tab") {
        const focusable = dialog.querySelectorAll<HTMLElement>(focusableSelector);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    for (const p of params) {
      if (p.required && !values[p.name]?.trim()) {
        newErrors[p.name] = `${p.label || p.name} is required`;
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    // Build the values object — only non-empty values
    const filled: Record<string, string> = {};
    for (const p of params) {
      if (values[p.name]?.trim()) {
        filled[p.name] = values[p.name].trim();
      }
    }

    onRun(filled);
  };

  const isEmpty = params.length === 0;
  const allRequired = params.every((p) => p.required);

  // Group params by agent for display
  const grouped = new Map<string, ProjectParam[]>();
  for (const p of params) {
    const key = p.agent_name || "Agents";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(p);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="run-params-title"
      aria-describedby="run-params-desc"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        className="relative bg-surface border border-border rounded-lg shadow-elevated w-full max-w-md animate-slide-up overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2
            id="run-params-title"
            className="text-base font-heading font-semibold text-foreground"
          >
            {isEmpty
              ? "Run cascade"
              : allRequired
                ? "Enter agent parameters"
                : "Optional parameters"}
          </h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors duration-150 cursor-pointer"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4">
          <p id="run-params-desc" className="text-sm text-muted mb-4">
            {isEmpty
              ? "The cascade will run with no parameters."
              : "Fill in the values below — each agent receives only the parameters assigned to it."}
          </p>

          {isEmpty ? (
            <div className="bg-elevated rounded-md px-3 py-2.5 text-xs text-muted mb-4">
              No parameters configured for the agents in this project.
            </div>
          ) : (
            <div className="space-y-4 mb-4">
              {[...grouped.entries()].map(([agentName, agentParams]) => (
                <div key={agentName}>
                  <p className="flex items-center gap-1.5 text-xs font-medium text-accent uppercase tracking-wide mb-2">
                    {agentName}
                    <span className="text-muted/60 normal-case font-normal">
                      ({agentParams.length} param{agentParams.length !== 1 ? "s" : ""})
                    </span>
                  </p>
                  <div className="space-y-3">
                    {agentParams.map((p, idx) => (
                      <div key={p.id}>
                        <label
                          htmlFor={`param-${p.name}`}
                          className="flex items-center gap-1 text-sm text-foreground mb-1.5"
                        >
                          {p.label || p.name}
                          {p.required && (
                            <span className="text-destructive" aria-label="required">
                              *
                            </span>
                          )}
                          {p.description && (
                            <span
                              className="text-muted cursor-help inline-flex"
                              title={p.description}
                              aria-label={p.description}
                            >
                              <HelpCircle size={13} />
                            </span>
                          )}
                        </label>
                        <input
                          ref={idx === 0 && agentName === [...grouped.keys()][0] ? firstInputRef : undefined}
                          id={`param-${p.name}`}
                          type="text"
                          value={values[p.name] ?? ""}
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [p.name]: e.target.value }))
                          }
                          placeholder={`Enter ${p.label || p.name}`}
                          className={`w-full bg-elevated border text-sm text-foreground rounded-md px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface transition-all duration-150 placeholder:text-muted/50 ${
                            errors[p.name]
                              ? "border-destructive"
                              : "border-border hover:border-accent/50"
                          }`}
                          aria-invalid={!!errors[p.name]}
                          aria-describedby={
                            errors[p.name] ? `err-${p.name}` : undefined
                          }
                        />
                        {errors[p.name] && (
                          <p
                            id={`err-${p.name}`}
                            className="text-xs text-destructive mt-1"
                          >
                            {errors[p.name]}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="text-sm font-medium rounded-md px-3 py-2 text-muted hover:text-foreground hover:bg-elevated transition-all duration-150 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md px-4 py-2 transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading
                ? "Starting…"
                : isEmpty
                  ? "Run cascade"
                  : "Run with parameters"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}