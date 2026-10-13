# Contrato técnico de produção — Fenômeno FB Peninga

**Documento de preparação, NÃO é autorização para emitir cobranças.**

## Ambientes e isolamento
| Componente | Sandbox/Preview | Produção |
|---|---|---|
| Vercel | Preview, branch `feat/supabase-asaas-backend` | `main` após aprovação |
| Asaas | `api-sandbox.asaas.com/v3` | `api.asaas.com/v3` |
| Banco | `oqefeihbtmzandayxoat` com fixtures | projeto Supabase **novo, exclusivo e vazio** |
| Webhook | bypass de automação da Preview + token de teste | endpoint HTTPS público próprio, token de produção diferente |
| Segredos | `ASAAS_SANDBOX_API_KEY`, `CHECKOUT_TEST_TOKEN` | `ASAAS_API_KEY` do cliente, segredos exclusivos de produção |

**Não apontar o checkout de produção para `oqefeihbtmzandayxoat`: contém dados e processos de teste.** A existência de `ASAAS_API_KEY` na Vercel não autoriza usar essa chave.

## Comportamento comercial aprovado
- Pacote de 3 coberturas por R$ 2.000: entrada R$ 100 por pacote; saldo contratual formalizado pelo comercial.
- À vista: 10% de desconto, cobrando o valor integral descontado.
- Cobertura individual R$ 1.000, ou R$ 900 à vista. O sistema Sandbox cobra entrada de R$ 100 também no individual; confirmar esse detalhe antes de publicar.
- Apenas uma cobrança inicial; não emitir as demais parcelas no sistema.
- Pago inicial parcelado -> `entry_paid` e aciona processo comercial. Não marcar como `paid` até quitação completa do contrato.
- Apresentar saldo, termos e contrato sem prometer emissão automática de 20 boletos.

## Implementação bloqueada até aprovação
- Provisionar um **novo banco Supabase** para produção e aplicar scripts de inicialização/segurança versionados, testando RLS e restrições de valor.
- Implementar `/api/checkout`, `/api/order-status` e `/api/asaas-webhook` específicos da produção, com fail-closed e armazenamento separado. Não reutilizar rota Sandbox na produção.
- Chave da conta Asaas de propriedade do cliente, verificação do beneficiário e permissões, e token de webhook distintos.
- Verificar idempotência, comportamento de timeout, pedido em conciliação, webhook duplicado/fora de ordem, reembolso e atualização do saldo.
- Agendar varredura de pagamentos não conciliados (sem recriar cobranças), alerta operacional e checklist diário de vendas.
- Remover token de homologação e linguagem de Sandbox na interface oficial.
- Confirmar limite de 100 aquisições e regra para esgotamento, além de documentação comercial e LGPD.
- Homologação final com autorização específica para cobrança real controlada e plano de reversão.
- Publicar somente após autorização explícita de merge/ativação.

## Verificações feitas
- Fluxo Sandbox aprovado no desktop e celular, inclusive F5, geração de boleto e atualização automática.
- O build passou a excluir `teste-integracao.html` e `reconciliar-sandbox.html` fora de Preview/branch autorizada.
- Checkout Sandbox permanece propositalmente travado em produção por `sandboxReady()`.
- Nenhuma cobrança de produção foi autorizada.

**Go/no-go**: no estado atual é **NO-GO para vendas reais** até completar os itens anteriores.
