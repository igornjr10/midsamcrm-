import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ContactFieldValue, FieldDef } from "@/lib/types";
import { parseFieldInput } from "@/lib/fields";

type Props = {
  fields: FieldDef[];
  values: Record<string, ContactFieldValue>;
  onChange: (key: string, value: ContactFieldValue) => void;
};

/**
 * Os campos personalizados como formulário. Data e número usam o input nativo
 * do tipo; select mostra as opções cadastradas mais "—" para limpar.
 */
export default function ContactFieldsForm({ fields, values, onChange }: Props) {
  if (fields.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map((field) => {
        const raw = values[field.key];
        const text = raw === null || raw === undefined ? "" : String(raw);
        return (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`field-${field.key}`}>{field.label}</Label>
            {field.type === "select" ? (
              <Select
                value={text || "__none"}
                onValueChange={(v) => onChange(field.key, v === "__none" ? null : v)}
              >
                <SelectTrigger id={`field-${field.key}`}>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {field.options.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={`field-${field.key}`}
                type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
                inputMode={field.type === "number" ? "decimal" : undefined}
                value={text}
                onChange={(e) =>
                  onChange(
                    field.key,
                    // Número só vira número ao sair do campo; enquanto digita,
                    // "1," precisa continuar existindo.
                    field.type === "number" ? e.target.value : parseFieldInput(field, e.target.value),
                  )
                }
                onBlur={(e) => {
                  if (field.type === "number") onChange(field.key, parseFieldInput(field, e.target.value));
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
