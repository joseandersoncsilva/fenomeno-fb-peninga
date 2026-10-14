# FB Peninga — checklist de liberação para 16/10

**Status: Preview em homologação; pagamentos reais e main NÃO autorizados.**

## Regras comerciais aprovadas
- Pacote 3 coberturas: R$ 2.000; entrada R$ 100 por pacote, saldo com comercial.
- Cobertura individual: R$ 1.000; entrada atual do código R$ 100 por pacote individual (reconfirmar se mantida na oferta).
- À vista: 10% de desconto — R$ 1.800 pacote de três; R$ 900 individual.
- A página não emite 19 parcelas: contrato e pagamento do saldo negociados pelo comercial.
- Não anunciar que a entrada liquida o contrato. Formalização posterior deve estar clara.

## Confirmado em Sandbox
- Checkout, cálculo no servidor, geração de boleto, idempotência, webhook e conciliação.
- Desktop: F5 manteve pedido FBP-43CB54DCF932 e pagamento atualizou para entry_paid.
- Mobile: pedido FBP-446C0F34107B e status entry_paid / saldo R$ 1.800 exibidos.
- O boleto Sandbox permite escolher Pix; confirmar modalidades de produção e experiência do cliente.

## Bloqueios de produção
1. **Separação real dos dados financeiros**: criar projeto/base de produção independente do banco Sandbox ou implementar isolamento robusto auditado, e migrações versionadas. Não mover dados de teste para a base real.
2. **Conta Asaas do cliente**: confirmar identidade do recebedor, chave de produção válida, permissão para cobrança, modalidades e tarifas, e endpoint próprio de webhook com token novo.
3. **Backend produção**: criar endpoints separados dos Sandbox, retirar bloqueio apenas no código específico de produção, manter autenticação de webhook, verificação remota de IDs/valores, idempotência e reconciliação de falhas.
4. **Operação**: monitoramento, alerta de falhas, fila/reenvio e auditoria da atualização de pedidos; conciliação periódica independente de webhook.
5. **UX**: remover token de teste, avisos de Sandbox e qualquer URL de Sandbox; consultar pagamento com acesso restrito por pedido, recuperar após refresh e verificar mesmo pedido em outro dispositivo via procedimento autenticado de suporte.
6. **Testes de produção controlados**: somente após autorização, uma cobrança real de baixo valor aprovada previamente, pagamento verificado, estorno/cancelamento e comunicação ao comprador.
7. **Validação comercial e jurídica**: política de privacidade, consentimento, contrato, estoque/limite de 100 aquisições, operação do time comercial e suporte.
8. **Go/no-go**: aprovação explícita do responsável antes de merge para main, habilitar cobrança real ou divulgar URL.

## Plano de rollback
Manter main intacta até aprovação; registrar versão/commit anterior, segredo de webhook e variáveis; caso falhe a verificação de pagamento, suspender novas cobranças e executar conciliação sem reenviar POST financeiro automaticamente.
