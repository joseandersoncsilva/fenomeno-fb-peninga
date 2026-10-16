# Painel privado de vendas — tarefa #8

Acesso em `/painel/`, somente leitura. A página estática contém apenas a tela de acesso; todos os dados vêm de `/api/sales-dashboard` após autenticação no servidor. A API fica indisponível por padrão, inclusive em Preview. Não há exemplos fictícios no produto.

## Única nova configuração em Production

Cadastrar `FBP_SALES_ACCESS_SECRET` na Vercel: segredo aleatório exclusivo, com pelo menos 32 caracteres (recomendado: 32 bytes aleatórios em hexadecimal). Não reutilizar chaves Supabase, Asaas, webhook ou status. Compartilhar a credencial com o prestador por canal privado. Não colocar o valor no GitHub, em URLs, no HTML ou em logs.

O código usa os valores Production existentes `FBP_PROD_SUPABASE_URL`, `FBP_PROD_SUPABASE_SECRET_KEY` e `FBP_CHECKOUT_ORIGIN`. O login deve ocorrer no domínio HTTPS definido em `FBP_CHECKOUT_ORIGIN`. Não usa chave Asaas nem depende da flag que habilita cobranças. Nenhuma variável financeira deve ser alterada.

Após revisão e merge autorizados, publicar e validar login, atualização e saída no domínio oficial. Configuração nova só entra no runtime após publicação. Rotacionar o segredo e republicar revoga todas as sessões existentes. Para desativar o painel, remover o segredo e republicar; isso não afeta checkout.

## Segurança e limites

- Comparação de credencial em tempo constante; sessão HMAC de uma hora, cookie `__Host-`, HttpOnly, Secure, SameSite=Strict e Path=/.
- Login/logout exigem origem oficial. Dados exigem cookie assinado e não aceitam credencial por query string. Respostas sem cache; CSP sem scripts inline, enquadramento ou recursos externos.
- Até cinco tentativas de login por IP em 15 minutos, inclusive entre instâncias serverless. Reutiliza `consume_production_checkout_limit` com HMAC e namespace `sales-login:`; escreve somente contadores técnicos já existentes, sem consumir as mesmas chaves do checkout. Não usa memória local como defesa contra força bruta. Falha no limitador bloqueia login.
- As consultas de vendas são exclusivamente GET, com campos explícitos. Nenhum CPF (nem completo nem parcial), e-mail, identificador Asaas ou URL de boleto é enviado à interface. Nome e telefone são exibidos apenas na sessão autenticada. Não há exportação ou armazenamento local/sessionStorage.
- A sessão é removida da tela na expiração, saída e navegação. Texto de comprador é inserido por textContent, evitando HTML executável. Respostas pendentes não repovoam a tela após saída.
- MVP com uma credencial compartilhada: não há identidade individual, papéis ou auditoria por operador. O cookie é um bearer token válido até expirar; logout remove o cookie deste navegador, rotação revoga todos.

## Métricas

- Pedidos gerados e valor contratado: pedidos oficiais desde 16/10/2026 às 6h de Brasília (09:00 UTC), inclusive cancelados. Os três testes identificados na tarefa #10 também são excluídos, mesmo se sua data mudar. Não significam vendas recebidas.
- Pedidos com entrada recebida: plano `entry` e pelo menos um pagamento RECEIVED ou RECEIVED_IN_CASH.
- Recebido no checkout: soma bruta dos pagamentos atualmente RECEIVED/RECEIVED_IN_CASH. CONFIRMED não entra. Não calcula taxas ou parcelas comerciais não cobradas. Pagamentos estornados/parcialmente estornados ou em contestação não são estimados como recebidos.
- Aguardando: pagamentos PENDING, OVERDUE e CONFIRMED. Em revisão: pedidos sinalizados ou com estorno parcial.
- Métricas paginam todos os pedidos até 10.000; acima disso a API falha explicitamente, sem exibir total truncado. Lista mostra os 50 mais recentes. Atualização manual ou a cada 60 segundos com aba visível. Leituras são operacionais, não um relatório contábil com snapshot transacional: alterações simultâneas podem aparecer na próxima atualização.

## Validação

Esquema, relacionamentos orders→customers/payments→orders e disponibilidade do limitador confirmados por SELECT no Supabase de produção. Nenhuma migração ou alteração financeira executada nesta tarefa.

`npm test`, `npm run build`, `npm run test:dashboard-browser`, `npm run test:browser`.

Os 10 novos testes de API cobrem autenticação, sessão expirada/adulterada, rotação, cookie, CSRF, rate limit persistente, métricas, paginação, ausência de dados privados indevidos, falhas e bloqueio em Preview. Navegador em 1440, 390 e 320 pixels cobre login, métricas, horário Brasília, XSS, atualização, estados vazio/erro, expiração e logout; screenshots em artifacts/dashboard-*.png. Todos os testes usam fixtures isoladas, sem tráfego Asaas ou cobranças. O CI executa os dois conjuntos de navegador.

A integração HTTP autenticada com dados reais deve receber um smoke test após configurar o segredo e publicar; não se declarou um teste de login Production ainda indisponível. Preview publica a tela estática, mas nunca dados Production. Checkout, webhook, preços e funções financeiras não foram editados.


## Minhas Comissões — tarefa #10

Cálculo somente para acompanhamento, sem persistência: 5% de `orders.total_cents`, arredondado ao centavo mais próximo por pedido (meio centavo para cima). O total já inclui quantidade e desconto à vista; R$ 1.800 gera R$ 90, e contrato de R$ 2.000 com entrada de R$ 100 gera R$ 100 de comissão em acompanhamento, nunca R$ 5.

- Potencial: pedido `awaiting_payment` com pagamento PENDING, sem estados conflitantes. Não representa venda fechada.
- Entrada paga — aguardando formalização: pedido `entry_paid`, sem cancelamento, estorno ou revisão financeira. Não comprova comissão confirmada, devida ou recebida.
- Vendas formalizadas: indisponível (`null` na API). Nem `paid` nem `entry_paid` substituem evidência comercial. O comprador à vista continua com os 5% do contrato descontado no detalhe, aguardando integração comercial, sem entrar artificialmente na categoria entrada paga.
- Cancelamentos, estornos, contestações e revisão financeira ficam fora das categorias ativas. O detalhe mostra os 5% como referência contratual, junto à categoria de exclusão.
- Todos os KPIs oficiais de vendas e comissões excluem `created_at < 2026-10-16T09:00:00Z` e referências FBP-576152F21879, FBP-C8F89092C3DF e FBP-826F3F91967E. Registros permanecem intactos e podem aparecer nos 50 pedidos recentes, identificados como histórico/teste. O filtro é aplicado no servidor, sem migração, exclusão de dados ou mudanças de status.
- Não há KPI de comissão repassada: forma e momento do repasse permanecem indefinidos.

Testes adicionais cobrem a fronteira exata do lançamento, exclusão dos três testes, soma por categoria, contrato à vista após desconto, valores em centavos, estornos, cancelamento, revisão e preservação do histórico na resposta autenticada. A interface mostra comissão e situação por comprador, e limpa esses dados ao sair/expirar. Nenhuma configuração adicional de ambiente é necessária.
