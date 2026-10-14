# Homologação do checkout — Fenômeno FB Peninga

**Resultado: fluxo de pagamentos homologado no Asaas Sandbox, na Preview. Produção desativada.**

Data: 09/10/2026, horário de Brasília. Evidências finais: 10/10/2026 02:35 UTC.
Repositório: `joseandersoncsilva/fenomeno-fb-peninga`.
Branch: `feat/supabase-asaas-backend`.
Supabase: `oqefeihbtmzandayxoat`.
Página: `/comprar/`.

## Confirmação automática demonstrada

| Modalidade | Pedido fictício | Cobrança | Estado automático | Saldo posterior |
|---|---|---:|---|---:|
| Entrada — pacote de 3 coberturas | FBP-C8ABD6C0BFF6 | R$ 100,00 | entry_paid | R$ 1.900,00 |
| Integral — 1 cobertura, desconto de 10% já previsto na página | FBP-4CADAFF670EB | R$ 900,00 | paid | R$ 0,00 |

As cobranças foram criadas pela API do checkout na Preview. A confirmação foi simulada pela operação oficial de confirmação do Sandbox. **Não foi chamado o endpoint de conciliação manual para produzir esses resultados.** Novos eventos `PAYMENT_RECEIVED`, enviados pelo próprio Asaas, fizeram a atualização no Supabase.

Evidências de entrada:
- Pagamento: `pay_0fghmoyr0glig8fe`, estado `RECEIVED`.
- Evento: `evt_d26e303b238e509335ac9ba210e51b0f&21560990`.
- Recebido: 02:35:07.529706 UTC; processado: 02:35:08.412393 UTC.

Evidências de pagamento integral:
- Pagamento: `pay_cw9r4aeybd13cu4b`, estado `RECEIVED`.
- Evento: `evt_d26e303b238e509335ac9ba210e51b0f&21561041`.
- Recebido: 02:35:20.708200 UTC; processado: 02:35:21.805782 UTC.

Registro auditável: `sandbox_verification_runs`, execução `run_20261010_fbp_automatic_v3`, estado `passed`, concluída às 02:35:24.299 UTC. O registro conserva IDs, horários e verificações, sem credenciais.

## O que foi corrigido

- `/comprar/` conectada ao backend Sandbox; emissão protegida por token de homologação, link do boleto e consulta do estado automático do pedido. Dados de cidade/estado e aceite explícito validados. Limite frontend/backend alinhado em 100 pacotes por pedido de teste.
- Identidade e valor financeiro confirmados na API do Asaas: cobrança, referência externa, comprador, modalidade e valor esperado devem corresponder. O valor/status enviados no corpo do webhook não são prova de pagamento.
- Pedido, pagamento e processamento do evento atualizados em uma transação no Supabase. Eventos atrasados não voltam um pagamento recebido para pendente nem ressuscitam um pagamento estornado.
- Reserva de pedido com `Idempotency-Key`, hash dos dados, bloqueios transacionais e reaproveitamento da resposta. Outro token de tentativa para o mesmo carrinho em 15 minutos reaproveita o pedido. Tentativas ainda em processamento ou com resultado incerto ficam bloqueadas até conciliação, sem expirar automaticamente.
- Timeout ou falha após uma possível emissão não provocam repetição automática do POST de cobrança. Pedido fica marcado para análise; recuperação consulta a referência externa e exige uma única cobrança compatível.
- Evento autenticado de cobrança externa ao checkout registrado como ignorado e respondido com HTTP 200. O antigo evento de R$ 5 sem pedido deixou de provocar HTTP 503.
- Token do webhook sincronizado com a variável server-side. Proteção da Preview e bypass previamente configurado preservados; nenhuma proteção foi desativada.
- Assinatura limitada a eventos de pagamento usados pelo checkout; envio alterado de sequencial para não sequencial, com conciliação independente da ordem de entrega.
- Logs reduzidos a identificadores técnicos; novos eventos armazenam apenas metadados necessários. SQL, testes e scripts não são publicados como arquivos estáticos.
- Conciliador manual usa a mesma transação financeira e pode recuperar cobrança por referência do pedido. Estorno parcial, chargeback e estados não homologados ficam sinalizados para análise financeira, sem declarar quitação.

## Testes executados

| Verificação | Resultado |
|---|---|
| 11 testes Node: autenticação, validação, bloqueio de produção/main, replay, webhook forjado e timeout de cobrança | Passaram |
| SQL no Supabase: reserva repetida/conflitante, um pedido, valor/cliente incorretos, entrada, atraso, estorno e cobrança externa | Passaram; dados revertidos por rollback |
| Repetição do checkout na Preview: mesma chave, chamadas paralelas de replay e outra chave para o mesmo carrinho | Mesmo pedido; 1 cobrança no Asaas por pedido |
| Mesma chave com quantidade alterada | HTTP 409 |
| Sem autenticação / corpo inválido autenticado | HTTP 401 / HTTP 400 |
| Webhook forjado recebido enquanto cobrança estava pendente | Pedido permaneceu aguardando pagamento |
| Confirmação oficial do Sandbox → novo webhook Asaas → Supabase | Entrada e quitação atualizadas automaticamente |
| Reenvio dos eventos recebidos do Asaas | HTTP 200, duplicate=true; sem novo pagamento |
| Consulta do estado do pedido pela API da página | HTTP 200; entry_paid / paid |
| Sintaxe do JavaScript da página, build e publicação da Preview | Passaram |
| Arquivo SQL pela URL pública da Preview | HTTP 404 |
| Auditoria Supabase | Sem alerta de segurança; apenas avisos informativos de RLS sem políticas públicas, conforme acesso exclusivo pelo servidor |

O primeiro teste aguardou apenas 48 segundos e falhou por atraso da fila antiga. O pedido `FBP-D869AD3210B6` posteriormente recebeu confirmação automática. A tentativa única de remover a penalização pela API não concluiu; não foi repetida em loop. A homologação final usou novos casos controlados com entregas independentes. Esses históricos de falha foram preservados.

## Limites e autorizações pendentes

- **Nenhuma cobrança de produção foi criada. Nenhum dado real foi usado nos novos testes. A branch main não foi alterada.** Referência de main verificada: `4c848badd77f1a18b692da656b14799872d9d300`.
- O checkout continua restrito a testes. Merge/publicação em produção, configuração das credenciais/webhook de produção e liberação ao público dependem de autorização específica e revisão da implantação de produção.
- Parcelas posteriores à entrada continuam sob formalização comercial. A emissão automática de todas as parcelas de um plano de 20x não faz parte do fluxo homologado. Taxas, vencimentos e condições comerciais devem ser aprovados antes dessa implementação.
- Estorno parcial e chargeback reais não foram testados ponta a ponta; o sistema exige análise financeira nesses estados. Estorno integral e atraso foram verificados por testes SQL.
- A confirmação foi testada de ponta a ponta por HTTP, com APIs reais do Sandbox e Supabase. O navegador da sessão chegou à tela de login da Vercel, e o Asaas não tinha sessão autenticada. A revisão visual desktop/mobile e o percurso por cliques no navegador protegido dependem de login; não foram apresentados como testes concluídos.
- Não foi configurada uma rotina periódica adicional de conciliação. Falhas do webhook permanecem registradas e são reenviadas pelo Asaas; recuperação manual protegida está disponível. Agendamento e alertas operacionais ficam para uma etapa de produção autorizada.

O disparo automático de homologação foi desativado após a execução (`FBP_SANDBOX_HOMOLOGATION=off`, apenas Preview/branch). Rebuilds normais não criam novas cobranças de teste.

## Referências oficiais usadas

- [Confirmar pagamento no Sandbox](https://docs.asaas.com/reference/confirmar-pagamento)
- [Atualizar webhook](https://docs.asaas.com/reference/atualizar-webhook-existente)
- [Penalização de filas](https://docs.asaas.com/docs/penaliza%C3%A7%C3%A3o-de-filas)
- [Funções e permissões no Supabase](https://supabase.com/docs/guides/database/functions)
