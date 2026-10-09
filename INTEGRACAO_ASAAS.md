# Integração Asaas — Fenômeno FB Peninga

## Estado atual
- Frontend da produção continua sem emissão de boletos.
- Apenas primeira cobrança: R$ 100 por pacote; à vista 10% de desconto.
- Os boletos posteriores serão formalizados pela equipe comercial.
- A chave de produção já está configurada pelo proprietário na Vercel; nunca armazenar no GitHub.
- Endpoints de boleto e webhook estão bloqueados intencionalmente com HTTP 503.

## Antes de habilitar
1. Criar banco de pedidos com restrição única por id de pedido e de cobrança.
2. Definir o prazo de vencimento inicial autorizado pelos proprietários.
3. Adicionar idempotência transacional à criação (evitar boletos duplicados e guardar identificador Asaas).
4. Implementar validação server-side dos dados pessoais; proteger contra abuso e limitar requisições.
5. Criar cliente Asaas, criar cobrança BOLETO, armazenar id, invoiceUrl, bankSlipUrl e status.
6. Configurar webhook autenticado pelo cabeçalho asaas-access-token, deduplicar eventos e registrar PAYMENT_CONFIRMED / PAYMENT_RECEIVED / estornos.
7. Guardar registros com controle de acesso e política de retenção LGPD.
8. Testar tudo com ASAAS_MODE=sandbox + chave sandbox, e fazer auditoria antes da ativação production.
9. Não interpretar criação do boleto como pagamento confirmado.
10. Atualizar frontend só depois de testes positivos.

## Variáveis servidor
- ASAAS_API_KEY (segredo)
- ASAAS_MODE (sandbox ou production; não inferir modo pela chave)
- ASAAS_WEBHOOK_TOKEN (segredo; ainda não configurado)
- Database credentials (a definir; segredo)

## Arquivos
- lib/asaas.js: mapeamento de cálculo/solicitação Asaas.
- api/checkout-quote.js: endpoint de simulação já existente.
- api/create-boleto.js: bloqueio até integração completa.
- api/asaas-webhook.js: bloqueio até integração completa.
