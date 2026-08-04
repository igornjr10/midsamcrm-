// Datas para o SDR IA.
//
// Sem isto o modelo responde com o ano em que foi treinado — um lead perguntou
// "09/08 é domingo?" e a IA respondeu "quinta-feira de 2024". Data e dia da
// semana são cálculo, não conhecimento: ficam no código e chegam prontos.

const DEFAULT_TZ = "America/Sao_Paulo";

/** "Hoje é terça-feira, 04 de agosto de 2026." — vai no topo do system prompt. */
export function todayBrief(timezone = DEFAULT_TZ, now = new Date()): string {
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  return `Hoje é ${fmt.format(now)}.`;
}

/** Data local (YYYY-MM-DD) no fuso da empresa, não no UTC do servidor. */
function localISO(timezone: string, date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return parts; // en-CA já formata como YYYY-MM-DD
}

export type DateInfo = {
  data: string;
  dia_semana: string;
  dias_a_partir_de_hoje: number;
};

/**
 * Aceita "2026-08-09", "09/08/2026" e "09/08" (ano corrente). Devolve o dia da
 * semana calculado, para a IA nunca precisar deduzir.
 */
export function describeDate(
  input: string,
  timezone = DEFAULT_TZ,
  now = new Date(),
): DateInfo | null {
  const texto = (input ?? "").trim();
  const hojeISO = localISO(timezone, now);
  const anoCorrente = Number(hojeISO.slice(0, 4));

  let ano: number, mes: number, dia: number;

  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const br = texto.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);

  if (iso) {
    [ano, mes, dia] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (br) {
    dia = Number(br[1]);
    mes = Number(br[2]);
    const anoTexto = br[3];
    ano = anoTexto
      ? Number(anoTexto.length === 2 ? `20${anoTexto}` : anoTexto)
      : anoCorrente;
  } else {
    return null;
  }

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;

  // Meio-dia UTC: qualquer fuso do Brasil continua no mesmo dia do calendário.
  const alvo = new Date(Date.UTC(ano, mes - 1, dia, 12));
  if (Number.isNaN(alvo.getTime())) return null;

  const diaSemana = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    weekday: "long",
  }).format(alvo);

  const hoje = new Date(`${hojeISO}T12:00:00Z`);
  const dias = Math.round((alvo.getTime() - hoje.getTime()) / 86_400_000);

  return {
    data: `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${ano}`,
    dia_semana: diaSemana,
    dias_a_partir_de_hoje: dias,
  };
}

/**
 * Deslocamento do fuso naquele instante (negativo a oeste de Greenwich).
 * Calculado comparando a data renderizada no fuso com o próprio instante —
 * não usa o fuso da máquina, que no servidor é UTC e no dev não é.
 */
function tzOffsetMs(date: Date, timezone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const comoUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return comoUTC - date.getTime();
}

/** Início e fim (UTC) do dia local — janela para consultar a agenda. */
export function dayRange(
  info: DateInfo,
  timezone = DEFAULT_TZ,
): { from: string; to: string } {
  const [dia, mes, ano] = info.data.split("/").map(Number);
  // Offset medido ao meio-dia daquele dia: pega o horário de verão certo.
  const offset = tzOffsetMs(new Date(Date.UTC(ano, mes - 1, dia, 12)), timezone);
  const inicio = new Date(Date.UTC(ano, mes - 1, dia, 0, 0, 0) - offset);
  return {
    from: inicio.toISOString(),
    to: new Date(inicio.getTime() + 86_400_000).toISOString(),
  };
}

export const CONSULTAR_AGENDA_TOOL = {
  type: "function",
  function: {
    name: "consultar_agenda",
    description:
      "Lista os compromissos já marcados numa data. Use antes de confirmar " +
      "disponibilidade — nunca afirme que um dia está livre sem consultar.",
    parameters: {
      type: "object",
      properties: {
        data: {
          type: "string",
          description: "A data, como 2026-08-09, 09/08/2026 ou 09/08",
        },
      },
      required: ["data"],
    },
  },
};

export const CONSULTAR_DATA_TOOL = {
  type: "function",
  function: {
    name: "consultar_data",
    description:
      "Descobre em que dia da semana cai uma data e a quantos dias dela estamos. " +
      "Use SEMPRE antes de afirmar dia da semana — nunca calcule de cabeça.",
    parameters: {
      type: "object",
      properties: {
        data: {
          type: "string",
          description: "A data, como 2026-08-09, 09/08/2026 ou 09/08",
        },
      },
      required: ["data"],
    },
  },
};
