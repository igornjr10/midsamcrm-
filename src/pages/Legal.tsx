import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo } from "@/components/layout/Logo";

/**
 * Política de Privacidade e Termos de Uso, públicas (fora do login).
 *
 * O Google exige as duas URLs na tela de consentimento do OAuth — o CRM pede a
 * permissão da Agenda — e a política precisa da cláusula de "Uso Limitado" da
 * Google API Services User Data Policy, que está na seção 5.
 *
 * Dados da empresa num lugar só: trocar aqui troca nos dois documentos.
 */
const EMPRESA = {
  nome: "Midsam",
  produto: "Midsam CRM",
  site: "https://app.midsam.com.br",
  email: "samuel@midsam.com.br",
  atualizado: "1º de outubro de 2026",
};

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/70">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" aria-label="Página inicial">
            <Logo />
          </Link>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <Link to="/privacidade" className="hover:text-foreground">Privacidade</Link>
            <Link to="/termos" className="hover:text-foreground">Termos</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Última atualização: {EMPRESA.atualizado}</p>
        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-foreground/90 [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:mt-1.5 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
      </main>
      <footer className="border-t border-border/70 py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} {EMPRESA.nome}. Dúvidas:{" "}
        <a href={`mailto:${EMPRESA.email}`} className="underline underline-offset-2">{EMPRESA.email}</a>
      </footer>
    </div>
  );
}

export function Privacidade() {
  return (
    <LegalLayout title="Política de Privacidade">
      <section>
        <p>
          Esta política explica como a {EMPRESA.nome} trata os dados pessoais no {EMPRESA.produto} ({EMPRESA.site}),
          plataforma de vendas, atendimento e relacionamento usada por empresas para conversar com seus clientes,
          inclusive pelo WhatsApp. Ela segue a Lei Geral de Proteção de Dados (Lei nº 13.709/2018, LGPD).
        </p>
      </section>

      <section>
        <h2>1. Quem é responsável pelos dados</h2>
        <p>
          Para os dados das contas de acesso (quem usa o CRM), a {EMPRESA.nome} é a <strong>controladora</strong>.
        </p>
        <p>
          Para os dados dos clientes e leads que cada empresa cadastra ou recebe no CRM, a empresa contratante é a{" "}
          <strong>controladora</strong> e a {EMPRESA.nome} atua como <strong>operadora</strong>: tratamos esses dados
          apenas para prestar o serviço, conforme as instruções da empresa contratante.
        </p>
      </section>

      <section>
        <h2>2. Dados que tratamos</h2>
        <ul>
          <li><strong>Conta de acesso:</strong> nome, e-mail, senha (guardada de forma criptografada) e empresa a que o usuário pertence.</li>
          <li><strong>Contatos e leads:</strong> nome, telefone, e-mail, data de nascimento, etiquetas, etapa no funil, origem e campos que a empresa configurar.</li>
          <li><strong>Conversas:</strong> mensagens de texto, áudios, imagens e documentos trocados pelo WhatsApp conectado ao CRM.</li>
          <li><strong>Agenda:</strong> compromissos criados no CRM e, se a empresa conectar o Google Agenda, os eventos sincronizados com ele.</li>
          <li><strong>Vendas e atendimento:</strong> pedidos, vendas, chamados, tarefas e registros que a empresa lançar.</li>
          <li><strong>Dados técnicos:</strong> registros de acesso e preferências salvas no navegador (como tema e menu recolhido).</li>
        </ul>
      </section>

      <section>
        <h2>3. Para que usamos</h2>
        <ul>
          <li>Prestar o serviço: mostrar as conversas, organizar o funil, agendar compromissos e enviar mensagens em nome da empresa.</li>
          <li>Automatizar o atendimento quando a empresa liga o assistente de IA: responder leads, transcrever áudios, identificar sinais de fechamento e ler comprovantes de pagamento.</li>
          <li>Manter a conta segura, dar suporte e cumprir obrigações legais.</li>
        </ul>
        <p>Não vendemos dados pessoais e não os usamos para publicidade.</p>
      </section>

      <section>
        <h2>4. Com quem compartilhamos</h2>
        <p>Só com os fornecedores necessários para o serviço funcionar, que tratam os dados em nosso nome:</p>
        <ul>
          <li><strong>Supabase</strong> — banco de dados, autenticação e armazenamento de arquivos.</li>
          <li><strong>Vercel</strong> — hospedagem do site.</li>
          <li><strong>Provedores de WhatsApp</strong> (Meta / WhatsApp Cloud API ou provedores de conexão por QR code) — envio e recebimento das mensagens.</li>
          <li><strong>OpenAI</strong> — processamento das mensagens pelo assistente de IA, quando ligado pela empresa.</li>
          <li><strong>Google</strong> — sincronização com o Google Agenda, quando conectado pela empresa.</li>
        </ul>
        <p>Também podemos compartilhar dados quando a lei ou uma autoridade competente exigir.</p>
      </section>

      <section>
        <h2>5. Dados do Google (Google Agenda)</h2>
        <p>
          Quando um usuário conecta a conta Google, o {EMPRESA.produto} pede acesso ao e-mail da conta e ao Google
          Agenda, para criar, atualizar e excluir no Google os compromissos feitos no CRM e trazer para o CRM os eventos
          criados no Google.
        </p>
        <p>
          O uso e a transferência, para qualquer outro aplicativo, de informações recebidas das APIs do Google seguirão
          a{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            Política de Dados do Usuário dos Serviços de API do Google
          </a>
          , incluindo os requisitos de Uso Limitado.
        </p>
        <ul>
          <li>Os dados do Google Agenda são usados apenas para a sincronização da agenda dentro do CRM.</li>
          <li>Não são vendidos, não são usados para publicidade e não são usados para treinar modelos de IA.</li>
          <li>Pessoas só acessam esses dados com autorização do usuário, para suporte, por segurança ou por obrigação legal.</li>
          <li>O usuário pode desconectar o Google a qualquer momento em Configurações, e também revogar o acesso em myaccount.google.com/permissions.</li>
        </ul>
      </section>

      <section>
        <h2>6. Por quanto tempo guardamos</h2>
        <p>
          Enquanto a conta da empresa estiver ativa. Quando a empresa encerra o contrato ou pede a exclusão, os dados
          são apagados em até 90 dias, salvo o que a lei obrigar a manter por mais tempo.
        </p>
      </section>

      <section>
        <h2>7. Segurança</h2>
        <p>
          Usamos conexão criptografada (HTTPS), senhas protegidas por hash, controle de acesso por empresa no banco de
          dados e chaves de integração guardadas fora do navegador. Nenhum sistema é 100% imune, mas adotamos medidas
          técnicas e administrativas para proteger os dados.
        </p>
      </section>

      <section>
        <h2>8. Seus direitos</h2>
        <p>
          Pela LGPD, o titular pode pedir confirmação de tratamento, acesso, correção, anonimização, portabilidade,
          eliminação e informação sobre compartilhamento, além de revogar consentimento. Se você é cliente de uma empresa
          que usa o CRM, fale primeiro com ela, que é a controladora dos seus dados; nós a ajudaremos a atender o pedido.
          Para os demais casos, escreva para{" "}
          <a href={`mailto:${EMPRESA.email}`} className="text-primary underline underline-offset-2">{EMPRESA.email}</a>.
        </p>
      </section>

      <section>
        <h2>9. Mudanças nesta política</h2>
        <p>
          Podemos atualizar esta política. A data no topo mostra a versão em vigor, e mudanças relevantes serão
          avisadas aos usuários.
        </p>
      </section>
    </LegalLayout>
  );
}

export function Termos() {
  return (
    <LegalLayout title="Termos de Uso">
      <section>
        <p>
          Estes termos regem o uso do {EMPRESA.produto} ({EMPRESA.site}), oferecido pela {EMPRESA.nome}. Ao criar uma
          conta ou usar o CRM, você concorda com eles e com a{" "}
          <Link to="/privacidade" className="text-primary underline underline-offset-2">Política de Privacidade</Link>.
        </p>
      </section>

      <section>
        <h2>1. O serviço</h2>
        <p>
          O {EMPRESA.produto} é uma plataforma online para gestão de leads, funil de vendas, atendimento pelo WhatsApp,
          agenda, campanhas e automações com inteligência artificial. Os recursos disponíveis dependem do plano
          contratado.
        </p>
      </section>

      <section>
        <h2>2. Conta e acesso</h2>
        <ul>
          <li>Cada usuário tem login próprio e é responsável por manter a senha em segredo.</li>
          <li>O administrador da empresa gerencia quem tem acesso e com qual papel.</li>
          <li>Avise-nos imediatamente se suspeitar de uso não autorizado da conta.</li>
        </ul>
      </section>

      <section>
        <h2>3. Responsabilidades da empresa contratante</h2>
        <ul>
          <li>Ter base legal (como consentimento ou relação comercial) para tratar os dados dos contatos que cadastra ou importa.</li>
          <li>Enviar mensagens apenas a quem aceitou receber e respeitar pedidos para parar de receber.</li>
          <li>Cumprir as políticas do WhatsApp e da Meta e a legislação aplicável, inclusive a LGPD e o Código de Defesa do Consumidor.</li>
          <li>Revisar as respostas e decisões automáticas da IA que forem relevantes para o negócio.</li>
        </ul>
      </section>

      <section>
        <h2>4. Uso proibido</h2>
        <p>Não é permitido usar o CRM para:</p>
        <ul>
          <li>enviar spam, mensagens em massa não solicitadas ou conteúdo enganoso;</li>
          <li>praticar fraude, golpes, assédio ou qualquer atividade ilegal;</li>
          <li>tentar acessar dados de outras empresas, burlar limites ou comprometer a segurança do sistema.</li>
        </ul>
        <p>O descumprimento pode levar à suspensão ou ao encerramento da conta.</p>
      </section>

      <section>
        <h2>5. Inteligência artificial</h2>
        <p>
          Os recursos de IA (respostas automáticas, transcrição de áudio, identificação de pagamento e leitura de
          comprovantes) podem errar. Eles apoiam o atendimento, mas não substituem a conferência humana em decisões
          importantes, como confirmar um pagamento.
        </p>
      </section>

      <section>
        <h2>6. Serviços de terceiros</h2>
        <p>
          Integrações como WhatsApp, Google Agenda e OpenAI dependem desses fornecedores e de suas próprias regras. A{" "}
          {EMPRESA.nome} não responde por indisponibilidades, bloqueios de número ou mudanças feitas por eles.
        </p>
      </section>

      <section>
        <h2>7. Disponibilidade</h2>
        <p>
          Trabalhamos para manter o CRM no ar continuamente, mas podem ocorrer interrupções para manutenção ou por
          falhas fora do nosso controle.
        </p>
      </section>

      <section>
        <h2>8. Propriedade e dados</h2>
        <p>
          O software, a marca e o visual do CRM pertencem à {EMPRESA.nome}. Os dados cadastrados pela empresa
          contratante continuam sendo dela, que pode exportá-los a qualquer momento.
        </p>
      </section>

      <section>
        <h2>9. Encerramento</h2>
        <p>
          A empresa pode encerrar o uso conforme o contrato do seu plano. Após o encerramento, os dados são apagados
          conforme a Política de Privacidade.
        </p>
      </section>

      <section>
        <h2>10. Limitação de responsabilidade</h2>
        <p>
          Na extensão permitida pela lei, a {EMPRESA.nome} não responde por lucros cessantes ou danos indiretos
          decorrentes do uso do CRM, nem por conteúdos enviados pelos usuários.
        </p>
      </section>

      <section>
        <h2>11. Lei aplicável</h2>
        <p>
          Estes termos seguem a legislação brasileira. Podemos atualizá-los, e a data no topo indica a versão em vigor.
          Dúvidas:{" "}
          <a href={`mailto:${EMPRESA.email}`} className="text-primary underline underline-offset-2">{EMPRESA.email}</a>.
        </p>
      </section>
    </LegalLayout>
  );
}
