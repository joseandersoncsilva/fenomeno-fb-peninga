# Checkout de produção — revisão da tarefa #4

Validado em 14/10/2026. Base: `feat/supabase-asaas-backend`, commit `6d702f40bc6c1e1e3fc1e4bc9f1fe9cad5de4fb0`.
**Ainda não autorizado para vendas em 16/10/2026 às 06h de Brasília.** Nenhuma cobrança real, publicação de produção, alteração de dados financeiros ou merge foi realizado.

## Alterações

- Separação entre emissão e leitura/conciliação. `FBP_PRODUCTION_PAYMENTS_ENABLED=false` bloqueia checkout e qualquer escrita no Asaas, mas permite webhook autenticado, consulta com acesso assinado e conciliação administrativa de pagamentos existentes. Endpoints e banco de produção continuam fixos e inacessíveis em Preview.
- Webhook valida token antes de acessar serviços, guarda apenas metadados, consulta a cobrança na API Production e aplica o resultado em transação. Repetições são serializadas pelo evento e pelo pedido; falhas retornam 503 para retentativa. O corpo recebido não pode declarar pagamento nem alterar valores.
- Checkout valida origem exata, IP fornecido pela Vercel, Turnstile no servidor (hostname e action), limites persistentes de 10 tentativas/IP e 5/CPF por 15 minutos. IP e CPF são identificados por HMAC na tabela de limites. Uma compra pendente ou em conciliação impede novo pedido; máximo de 3 pedidos/CPF por 24 horas. Replay preserva idempotência. Os limites são conservadores e devem ser revisados pelo responsável comercial.
- Valores conferidos no servidor e calculados também no SQL: pacote triplo R$2.000, individual R$1.000, entrada R$100 por unidade adquirida; à vista R$1.800/R$900. Nenhuma parcela futura é emitida. Entrada recebida gera `entry_paid`, não quitação integral.
- Recibo só é restaurado depois da configuração do ambiente; funciona após F5 e com vendas pausadas, inclusive em domínio personalizado. Corrigidos rótulos de Sandbox em produção, aviso de privacidade e mensagens de indisponibilidade.

## Evidências executadas

- `npm test`: 39 testes em 4 arquivos, aprovados. Inclui 11 testes com PostgreSQL embarcado (PGlite), sem conexão com Supabase. O esquema das tabelas foi atualizado a partir de consulta somente de leitura ao catálogo de produção; as funções e a tabela de limites são carregadas diretamente de `db/production-hardening.sql`.
- Casos de endpoint invocando os handlers: checkout desligado **503**; webhook GET **405**; webhook sem token/token inválido **401**; webhook autenticado com consulta remota simulada **200**; repetição **200** sem reaplicar; falha remota/identidade divergente **503**. Clientes não conseguem forjar pago. Nenhuma chamada real a Asaas/Turnstile foi feita.
- PostgreSQL: preços das quatro ofertas, replay, chave alternativa, conflito, limite de pedidos e tentativas, identidade/valor incorreto, entrada/saldo, quitação à vista, estorno, evento antigo, cancelamento, falha com rollback e permissões públicas.
- `npm run build`: aprovado; saída pública exclui consoles de homologação e arquivos internos.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`: desktop 1440×1000, celular 390×844 e 320×740. Fluxo de cinco etapas, campos obrigatórios, revisão, carregamento, erro com recuperação da mesma tentativa, recibo, saldo, F5 com vendas desligadas, botão bloqueado e ausência de senha de homologação no fluxo de produção. Sem overflow horizontal nem erro JavaScript. Todas as requisições externas bloqueadas ou simuladas; Turnstile real ainda precisa de validação no domínio final.
- Capturas locais em `artifacts/*-{sales,review,receipt}.png`. O workflow `Checkout safety` publica as capturas como artifact do CI.
- `npm audit --audit-level=moderate`: zero vulnerabilidades.
- Consulta somente de leitura no Supabase de produção: RLS habilitada nas cinco tabelas financeiras; `anon` e `authenticated` sem SELECT/INSERT/UPDATE nelas e sem EXECUTE nas duas funções financeiras existentes.
- Consulta somente de leitura à Vercel confirmou **`FBP_PRODUCTION_PAYMENTS_ENABLED=false`**, escopo production. Nenhum segredo foi exibido ou copiado para arquivos.

As evidências locais não comprovam deploy, concorrência entre sessões de Postgres remoto nem entrega real do Asaas. O endpoint final não foi publicado nesta tarefa.

## Reproduzir

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:browser
# Alternativa com Chromium instalado:
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

Testes não dependem de credenciais. Variáveis fictícias de habilitação existem somente nos processos de teste, com fetch substituído. O CI mantém a flag global em false e não recebe segredos financeiros.

## Pendências obrigatórias antes de liberar vendas

1. Revisar/aprovar o PR, o SQL e as regras comerciais. Confirmar como será controlado o estoque anunciado de 100 aquisições; este PR limita abuso e pedidos por comprador, não implementa estoque global. Confirmar contrato, beneficiário, canal de suporte e formalização manual das 19/9 parcelas restantes.
2. Configurar Turnstile para o domínio final: `FBP_TURNSTILE_SITE_KEY` (pública), `FBP_TURNSTILE_SECRET_KEY` (secreta) e `FBP_CHECKOUT_ORIGIN` (origem HTTPS exata, sem barra final). Ausência de qualquer uma mantém a emissão bloqueada. Confirmar token do webhook com pelo menos 32 caracteres e segredo separado `FBP_PROD_RECONCILE_SECRET` caso o conciliador administrativo seja utilizado.
3. Após aprovação específica, aplicar `db/production-hardening.sql` no banco de produção existente. Não aplicar `sandbox-hardening.sql` em produção. O script exige as tabelas já provisionadas; é transacional, usa SECURITY INVOKER e grants exclusivos para service_role. Build/deploy não aplica SQL automaticamente. Validar grants/RLS e concorrência em homologação antes de habilitar vendas.
4. Publicar somente após aprovação, mantendo **`FBP_PRODUCTION_PAYMENTS_ENABLED=false`**. No domínio final verificar GET `/api/asaas-production-webhook` = **405** (não 404), POST sem token = **401**, POST `/api/checkout` = **503**. Validar Turnstile/origem/IP e recibo no navegador real. Não enviar payload de pagamento fictício para produção nem criar cobrança real nesta etapa.
5. Com o endpoint publicado e a identidade/configuração da conta conferida, combinar validação autorizada do webhook: token correto, cobrança existente identificada e resposta **200** somente após processamento verificado. **Não orientar Alan a ativar o webhook enquanto a rota não responder corretamente.** A validação com evento/cobrança real exige autorização específica; não foi realizada aqui.
6. Definir responsável por alertas, retentativas, conciliação e atendimento. Limpar periodicamente `production_checkout_limits` com `window_start` anterior a 24 horas, sem remover registros do período ativo. Revisar política de retenção dos dados pessoais e o acesso ao recibo salvo no dispositivo.
7. Somente após revisão humana e todos os critérios acima, autorizar separadamente a habilitação das vendas. A flag deve permanecer false até essa decisão.

## Reversão

Desligar vendas com `FBP_PRODUCTION_PAYMENTS_ENABLED=false` impede novas emissões e mantém webhook/status/conciliação funcionando. Não reemitir cobrança após timeout: usar a referência e o conciliador autorizado. Não remover pedidos, pagamentos ou eventos para tentar novamente.

Atualização de preparação: consulte `PREPARACAO_PRODUCAO_PR5.md` para estado atual do domínio, Turnstile e validação sobre o esquema real.
