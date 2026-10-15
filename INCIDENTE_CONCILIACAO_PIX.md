# Correção de conciliação: boleto recebido via Pix

## Causa comprovada e limite da evidência

Pedido informado: `FBP-576152F21879`. Cobrança existente: `pay_ib5lms0m5ydx13h8`. Entrada: R$100; contrato: R$2.000; saldo esperado após entrada: R$1.900.

Na requisição Vercel `dzg8d-1792063135177-db46a82bf6af` de 15/10/2026 às 11:18:57 UTC (08:18:57 Brasília), o webhook consultou a cobrança na API Production do Asaas e registrou somente este formato:

```json
{"status":"RECEIVED","billingType":"PIX","installmentPresent":false,"subscriptionPresent":false,"paymentDatePresent":true,"remoteReferenceMatchesCheckout":true}
```

A mesma requisição registrou RPC `apply_production_payment`, HTTP400 / PostgreSQL `P0001`, seguida da resposta 503 do webhook. O evento RECEIVED está persistido e não processado. O banco tem a cobrança BOLETO/PENDING, vinculada ao pedido, com 10000 centavos.

A definição instalada da função contém:

```sql
p_remote->>'billingType' is distinct from 'BOLETO'
```

Esse predicado é verdadeiro para a resposta real `PIX` e dispara `raise exception 'Payment identity or amount mismatch'` (`P0001`). A reprodução local usa a definição anterior instalada e comprova exatamente essa mensagem/código, mantendo corretos ID, cliente, referência e valor. A exceção agregava também outras validações, que agora têm motivos separados e seguros para diagnóstico.

A evidência da consulta Asaas é a chamada real feita pelo webhook e seu log correlacionado. Não houve uma nova consulta autenticada direta ao Asaas nesta sessão: a chave existe somente no runtime Vercel; não foi exportada e não há conector Asaas ou segredo disponível neste ambiente. Portanto os demais campos da resposta atual não são apresentados como novamente verificados. A correção exige sua validação em uma nova leitura antes de qualquer conciliação.

## Correção preparada

- BOLETO continua sendo a única modalidade de criação no checkout. Nenhum POST para criar/confirmar pagamento foi executado.
- Aceitar `PIX` na conciliação somente quando o mesmo payment ID já está registrado para o mesmo pedido, com o mesmo valor e modalidade registrada BOLETO/PIX.
- Continuam obrigatórios referência externa, vínculo ao cliente Asaas, valor inicial, cobrança única, ausência de assinatura/parcelamento, locks de evento/pedido e ACK transacional. Pix desconhecido, valor/cliente divergente ou outra titularidade continuam rejeitados.
- Persistir a modalidade real PIX sem regressão quando chegar leitura antiga BOLETO/PENDING. O resultado continua `entry_paid`, `RECEIVED`, 190000 centavos de saldo; não quitação integral.
- Logs de erro passam a aceitar somente mensagens literais conhecidas. Corpo remoto, dados pessoais e credenciais não são registrados.

O patch mínimo é `db/production-pix-settlement.sql`: substitui **somente** `public.apply_production_payment(jsonb,text)` e preserva suas permissões. Não executa UPDATE manual, não força status e não chama a função financeira. O hardening completo foi atualizado para manter a mesma definição.

SHA-256 do patch mínimo:
`94e10adfd2653058f5046c62adb6d60f70964095d62774850e70522fa651b59f`

## Testes

- `npm test`: 45 testes aprovados, incluindo regressão do P0001 com a função anterior, recebimento PIX de BOLETO previamente registrado, duplicação do mesmo evento, retentativa após falha transacional, evento antigo, identidade/cliente/valor incorretos, cobrança Pix desconhecida e parcelamento/assinatura.
- Handler do webhook: consulta API simulada, 503 antes de correção/falha RPC, 200 na retentativa e 200 na duplicata sem reaplicar.
- SQL: mesmo resultado financeiro e uma única linha de pagamento. Nenhuma alteração no banco de produção; apenas PostgreSQL embarcado com dados fictícios.
- `npm run build`: aprovado. Testes de checkout foram ajustados para a consulta de telefone já adicionada à main; o código de emissão não foi alterado.

## Preparação de consulta e recuperação

O PR adiciona uma modalidade administrativa **GET, somente leitura** em `/api/reconcile-production`, protegida pelo segredo separado `FBP_PROD_RECONCILE_SECRET`. Ela consulta diretamente o pagamento existente via `GET /v3/payments/{id}` e retorna somente status/modalidade e booleanos de verificação, sem cliente ou dados pessoais.

Após publicação autorizada e configuração privada desse segredo (ainda ausente), a consulta será:

```text
GET /api/reconcile-production?reference=FBP-576152F21879&paymentId=pay_ib5lms0m5ydx13h8
Header: x-reconciliation-secret (fornecido pelo armazenamento seguro, nunca no chat)
```

Esperado: `readOnly=true`, `verified=true`, `remoteStatus=RECEIVED`, `remoteBillingType=PIX`. Nenhuma escrita ocorre nesse GET. Na versão anterior a requisição é rejeitada com 405; não usar `POST` com um campo inventado `dryRun`, pois o POST atual grava dados.

## Autorizações necessárias e sequência mínima

1. **Aprovar a aplicação do patch SQL mínimo** identificado acima no projeto `nnysmymyvsydikdwlprg`. Não reaplicar todo o hardening. O código já publicado do webhook é suficiente para ler novamente o Asaas e usar a função corrigida; merge do novo PR não é requisito técnico para destravar a retentativa.
2. Essa autorização deve incluir permitir a **retentativa do evento real já pendente**: assim que o patch for aplicado, uma entrega automática do Asaas poderá consultar o pagamento atual e conciliar a transação. Se não houver retentativa automática, solicitar a reentrega do evento original pelo Asaas. Não simular recebimento nem enviar status/valor fabricados.
3. Verificar por leitura que o evento tem processed_at, o pedido está entry_paid, o pagamento RECEIVED, o saldo é 190000 centavos e existe uma só cobrança vinculada. Se qualquer verificação remota falhar, manter 503/revisão; não editar registros para contornar validação.
4. **Aprovação separada para merge/publicação** do PR habilita mensagens de diagnóstico e GET administrativo. Essa etapa não muda registros financeiros por si só. O POST administrativo só deve ser usado com aprovação de conciliação e sempre consulta o Asaas antes de aplicar o estado remoto.

Nenhuma dessas etapas de produção foi executada nesta investigação. A flag observada nesta sessão está `FBP_PRODUCTION_PAYMENTS_ENABLED=true`, diferente da preparação anterior; não foi alterada. O webhook e o GET administrativo também funcionam com a flag false, caso seja autorizada uma pausa de novas vendas.
