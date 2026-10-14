# Publicação preparada — PR #5

Revisão de 14/10/2026. Abertura desejada: 16/10/2026, 06:00 America/Bahia (Brasília, UTC−3).
Página de vendas: **https://fenomeno-fb-peninga.vercel.app/comprar/**.

## Estado e compatibilidade

- PR #5 sem conflito com main `2c4370c`. Não houve merge, deploy Production, alteração no Supabase ou cobrança real.
- Preview revisada: commit `96a2a2e`, deployment `dpl_AmaK8nAv7hGUtBDEKezVWqYnTrPD`, READY. `/comprar/` retorna 200 e seu HTML é idêntico ao arquivo testado localmente. Webhook GET retorna 405. Configuração da Preview mantém pagamentos desligados, sem usar credenciais de produção.
- Produção ainda roda main `2c4370c`. Webhook GET retorna 404, como esperado antes da publicação. `/api/production-readiness` retorna 200, credenciais existentes configuradas e `paymentsEnabled=false`. A variável `FBP_PRODUCTION_PAYMENTS_ENABLED` foi consultada e permanece `false`.
- `FBP_CHECKOUT_ORIGIN=https://fenomeno-fb-peninga.vercel.app` já foi cadastrada na Vercel, somente em Production. Não houve redeploy. Essa configuração não habilita cobranças.
- A raiz `/` continua sendo a página-ponte para WhatsApp. Divulgação de vendas deve usar `/comprar/`; não presumir que a raiz passou a ser checkout.

## Cloudflare Turnstile — configuração preparada

Payload sem credenciais: `deploy/turnstile-production.json`.

| Campo | Valor |
|---|---|
| Widget name | Fenômeno FB Peninga — Checkout produção |
| Hostname | `fenomeno-fb-peninga.vercel.app` (sem protocolo ou caminho) |
| Widget mode | Managed |
| Pre-clearance | Desativado (`no_clearance`) |
| Action, definida no código | `checkout` |
| Apresentação, definida no código | Tema dark, tamanho compact (150×140) |

O domínio é o único Production verificado no projeto Vercel. Não adicionar `vercel.app` inteiro, localhost ou hosts de Preview ao widget de produção. Não é necessário transferir DNS para a Cloudflare.

**Única configuração externa que depende do titular da conta:** criar esse widget em [Cloudflare → Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) e cadastrar as duas chaves em [Vercel → Environment Variables](https://vercel.com/jose-andersons-projects-625eb4e4/fenomeno-fb-peninga/settings/environment-variables), escopo **Production**:

| Variável | Conteúdo | Tipo |
|---|---|---|
| `FBP_TURNSTILE_SITE_KEY` | Site key retornada pelo widget | Config/pública |
| `FBP_TURNSTILE_SECRET_KEY` | Secret key retornada pelo widget | Secret/Sensitive |

Não colocar a Secret key no chat, GitHub, frontend ou Preview. Basta informar que as variáveis foram cadastradas. Não cadastrar chaves de teste da Cloudflare em produção. Nenhum conector/autenticação Cloudflare está disponível nesta sessão para criar o widget em nome do usuário.

Referência consultada: [criação oficial de widgets](https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/).

## Configuração existente e preservada

`ASAAS_API_KEY`, `FBP_PROD_ASAAS_WEBHOOK_TOKEN`, `FBP_PROD_SUPABASE_URL`, `FBP_PROD_SUPABASE_SECRET_KEY` e `FBP_PROD_STATUS_SECRET` já estão cadastradas em Production. Valores secretos não foram lidos nem exportados. O banco esperado é `nnysmymyvsydikdwlprg`; a chave Asaas só é usada com `https://api.asaas.com/v3`.

A flag permanece **`FBP_PRODUCTION_PAYMENTS_ENABLED=false`**. `FBP_PROD_RECONCILE_SECRET` é opcional para habilitar o endpoint administrativo de conciliação, não para checkout/webhook/recuperação pelo recibo. Sem esse segredo o conciliador administrativo rejeita acesso. Nenhuma ação de configuração desse segredo é exigida do usuário nesta etapa.

## SQL validado contra o esquema real, sem escrita remota

Consultas de catálogo somente de leitura exportaram colunas, tipos, defaults, NOT NULL, CHECK, UNIQUE, PK/FK, índices e definições das funções existentes. Não foram exportados compradores, pedidos ou pagamentos. O snapshot está em `tests/fixtures/production-schema.sql`.

O PostgreSQL embarcado agora executa o hardening sobre esse esquema real, em vez do esquema mínimo inicial. As assinaturas das funções substituídas são compatíveis. As restrições aceitam os valores e estados produzidos pelo fluxo. O script cria uma tabela e uma função de limites e substitui duas funções; não contém DROP, TRUNCATE ou DELETE de dados existentes. Teste adicional comprovou reaplicação local preservando pedido e pagamento existentes. Isso não substitui um ensaio de concorrência multi-sessão em um clone de homologação, nem aplica qualquer mudança no banco remoto.

Arquivo que aguarda autorização para aplicação:

- `db/production-hardening.sql`
- SHA-256: `a73a05f5f88da05abcf17da698ea93d90d86313c1b5075053d4a71e309b9d31d`
- Alvo: projeto `nnysmymyvsydikdwlprg`.

RLS está habilitada nas cinco tabelas financeiras; anon/authenticated não têm SELECT/INSERT/UPDATE e service_role tem as permissões necessárias. O advisor não apontou avisos WARN/ERROR; apenas [RLS sem políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), intencional para tabelas acessíveis exclusivamente pelo backend.

## Evidências desta revisão

- 39 testes de backend/SQL, incluindo 11 sobre o esquema real reproduzido localmente.
- Build aprovado.
- Chromium 1440×1000, 390×844 e 320×740: quatro ofertas, entrada R$100, totais R$1.000/R$2.000 e à vista R$900/R$1.800; widget compact; validação, erro/carregamento, recibo, entrada paga com saldo e F5 com vendas pausadas. APIs de cobrança e CAPTCHA simuladas, sem chamadas financeiras.
- Integração Production mantém isolamento de Sandbox, verificação remota de identidade e idempotência. O webhook autenticado 200 foi validado com serviços simulados; entrega real na URL final só pode ser validada após publicação autorizada.

## Sequência pronta, aguardando as autorizações do usuário

1. Cadastrar as duas chaves Turnstile acima. O restante da configuração necessária já está preparado.
2. Com autorização explícita, aplicar exatamente o SQL identificado acima. Não recriar tabelas financeiras, importar fixtures ou aplicar scripts Sandbox.
3. Com autorização explícita, fazer merge/publicar o PR #5 em main, mantendo a flag false. Revisar novamente o head e os checks antes do merge. O diff inclui a implementação anterior de `feat/supabase-asaas-backend`; não é só o commit de hardening.
4. Executar `node scripts/verify-release.mjs`: verifica 405/401 no webhook, 503 no checkout, ambiente Production, flag false e prontidão de configuração. Não usa segredo, identificador de pagamento ou comprador válido e não cria cobrança. O script está preparado, mas não foi executado contra a versão ainda não publicada.
5. Conferir o widget real no domínio final e o endpoint Asaas `https://fenomeno-fb-peninga.vercel.app/api/asaas-production-webhook`, com autenticação pelo token Production já existente. Não orientar Alan a ativar antes de a rota responder corretamente. Qualquer entrega real verificada ou teste financeiro exige a autorização correspondente; o script de smoke não simula um webhook autenticado em produção.

## Riscos que permanecem para a abertura de vendas

- Com a flag false, publicar a página não abre o checkout. Habilitação financeira é decisão separada, não incluída nesta preparação.
- “Primeiras 100 aquisições” aparece na oferta, mas não há estoque global automático. Os limites atuais são antiabuso (um pedido pendente e três pedidos/CPF/dia), não controle das 100 aquisições. Confirmar controle comercial ou especificar unidade/reserva de estoque antes da abertura.
- Chaves Turnstile ainda não cadastradas; até isso acontecer o novo guard impede emissão, mesmo se alguém alterar a flag por engano.
- Não alterar/rotacionar a chave de assinatura do status durante o lançamento sem plano: os recibos assinados existentes expiram/inviabilizam recuperação quando a chave muda. O recibo tem validade de 7 dias e fica no dispositivo; ausência dele exige atendimento/recuperação administrativa.
- A entrada não quita o contrato e as 19/9 parcelas restantes dependem do comercial. Nenhuma parcela futura é emitida automaticamente.

Próxima ação humana: **criar o widget Turnstile e cadastrar as duas chaves em Production; avisar que foi concluído, sem enviar os valores secretos.**
