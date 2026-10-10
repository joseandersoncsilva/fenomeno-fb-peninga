# Integração Supabase + Asaas — FB Peninga

**Checkout Sandbox homologado na Preview. Cobranças reais desativadas.**

Consulte `HOMOLOGACAO_SANDBOX.md` para resultados, eventos recebidos e limites da homologação.

## Ambiente autorizado

- GitHub: `joseandersoncsilva/fenomeno-fb-peninga`, branch `feat/supabase-asaas-backend`.
- Vercel: `fenomeno-fb-peninga`, exclusivamente Preview.
- Supabase: `oqefeihbtmzandayxoat`.
- Página de vendas: `/comprar/`.
- Asaas: exclusivamente `https://api-sandbox.asaas.com/v3`.

Os endpoints rejeitam produção e outras branches. `index.html` da página-ponte permanece sem alterações.

## Variáveis server-side

`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ASAAS_ENV=sandbox`, `ASAAS_SANDBOX_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `CHECKOUT_TEST_TOKEN`.

Não versionar valores secretos nem usar prefixos públicos. A chave de produção existente não é usada por esse fluxo. O webhook exige `asaas-access-token`; checkout, estado e conciliação exigem `x-checkout-test-token`.

## Contratos

- `GET /api/checkout-config`: configuração pública sem credenciais; pagamentos reais sempre desativados.
- `POST /api/checkout-sandbox`: comprador fictício, CPF de fixture válido, telefone, cidade/UF, privacy=true, packageType 1 ou 3, quantity 1–100, paymentPlan entry ou cash; exige `Idempotency-Key` de 16–100 caracteres.
- `POST /api/asaas-webhook`: autenticação, metadados únicos, consulta à API do Asaas e transação financeira. Sucesso somente com HTTP 200.
- `POST /api/order-status-sandbox`: reference do pedido; retorna estado e saldo, sem dados pessoais.
- `POST /api/reconcile-sandbox`: paymentId ou reference; consulta remota antes de corrigir registros, sem emitir cobrança.

A entrada custa R$ 100 por pacote. Contratação: R$ 2.000 por pacote de 3 coberturas ou R$ 1.000 pela cobertura individual. Pagamento integral aplica o desconto de 10% que já constava na página. A entrada não significa quitação; parcelas posteriores continuam sob formalização comercial.

## Banco e segurança

`db/sandbox-hardening.sql` é o script reproduzível aplicado ao projeto existente. Não é uma migração de inicialização: pressupõe as quatro tabelas anteriores. Foram adicionadas `checkout_requests` e `sandbox_verification_runs`.

Todas as tabelas usam RLS, sem políticas públicas. As duas funções financeiras usam SECURITY INVOKER, search_path fixo e permissão exclusiva para service_role. Não expor funções/tabelas financeiras ao navegador.

Resultados ambíguos ficam em needs_review e impedem nova emissão automática. O conciliador busca uma cobrança pela referência externa; múltiplas cobranças exigem análise. O banco aceita apenas a cobrança inicial deste fluxo, sem assinatura ou parcelamento automático.

## Verificação

- `npm test`: testes locais sem credenciais reais.
- `tests/database-rollback.sql`: asserções no Supabase com rollback.
- `npm run build`: copia somente arquivos públicos; não dispara homologação por padrão.
- `scripts/homologate-sandbox.mjs`: execução manual controlada dentro da Vercel, opt-in por ID único em `FBP_SANDBOX_HOMOLOGATION`, apenas Preview/branch. Pode criar e confirmar cobranças fictícias; não habilitar sem intenção de testar. Cada run_id é registrado e não se repete automaticamente. `FBP_SANDBOX_FIXTURE_RUN` é opcional para reaproveitar uma tentativa previamente identificada.

A homologação lê a configuração existente do webhook sem registrar tokens/URL de bypass, testa autenticação/idempotência e exige novos eventos do Asaas. Nenhuma conciliação manual substitui a confirmação automática exigida pelo teste.

Estado final das flags: homologação `off`, fixture de retomada vazia. Deploys normais não movimentam o Sandbox.

## Antes de produção

Autorização para publicação/merge e pagamentos reais; revisão das condições comerciais, política/consentimento, credenciais de produção e webhook; definição de parcelas posteriores, monitoramento e recuperação operacional. A revisão visual no navegador protegido ainda exige login. Não promover esta Preview diretamente esperando habilitar produção: os bloqueios atuais são intencionais.
