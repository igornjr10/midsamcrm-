import { VARIABLE_SOURCE_LABELS } from "@/lib/templates";
import type { VariableSource } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SOURCE_OPTIONS: VariableSource["source"][] = [
  "contact_first_name",
  "contact_name",
  "contact_phone",
  "contact_email",
  "text",
];

/** Define de onde sai o valor de um placeholder ({{n}}) do template. */
export default function VariableRow({
  index,
  value,
  onChange,
}: {
  index: number;
  value: VariableSource;
  onChange: (next: VariableSource) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="font-mono">{`{{${index + 1}}}`}</Badge>
      <Select
        value={value.source}
        onValueChange={(source) =>
          onChange(source === "text" ? { source: "text", value: "" } : ({ source } as VariableSource))
        }
      >
        <SelectTrigger className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SOURCE_OPTIONS.map((source) => (
            <SelectItem key={source} value={source}>
              {VARIABLE_SOURCE_LABELS[source]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.source === "text" && (
        <Input
          className="min-w-[10rem] flex-1"
          placeholder="Valor fixo"
          value={value.value}
          onChange={(e) => onChange({ source: "text", value: e.target.value })}
        />
      )}
    </div>
  );
}
