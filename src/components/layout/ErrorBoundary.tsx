import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Sem isto, qualquer erro de execução desmonta a árvore inteira do React e
 * sobra tela preta — sem mensagem, sem pista, e quem está usando só vê o CRM
 * "sumir". Aqui o erro fica na tela, com o texto que o console mostraria.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Erro na tela:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-lg rounded-xl border bg-card p-6 shadow-card">
          <h1 className="text-lg font-bold">Algo quebrou nesta tela</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            O resto do sistema continua funcionando — use o menu para ir a outra página.
            Se o erro se repetir, mande o texto abaixo para o suporte.
          </p>
          <pre className="scrollbar-slim mt-3 max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              className="rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
              onClick={() => this.setState({ error: null })}
            >
              Tentar de novo
            </button>
            <button
              className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
              onClick={() => window.location.reload()}
            >
              Recarregar
            </button>
          </div>
        </div>
      </div>
    );
  }
}
