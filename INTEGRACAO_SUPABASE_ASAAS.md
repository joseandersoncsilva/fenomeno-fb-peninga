# Integração Supabase + Asaas — FB Peninga

**Status: preparação técnica, NÃO publicar cobranças reais.** Esta branch não altera a página-ponte `index.html`.

## Projeto Supabase
- ID: `oqefeihbtmzandayxoat`
- API URL: `https://oqefeihbtmzandayxoat.supabase.co`
- Tabelas existentes: `customers`, `orders`, `payments`, `asaas_webhook_events`.
- RLS habilitado, sem acesso público: operações apenas por servidor autorizado.

## Variáveis de ambiente na Vercel (server-side)
- `SUPABASE_URL`: URL do projeto acima.
- `SUPABASE_SECRET_KEY`: chave de servidor do Supabase (NUNCA usar NEXT_PUBLIC_ ou colocar em HTML).
- `ASAAS_WEBHOOK_TOKEN`: token de autenticação do webhook, DIFERENTE da API key Asaas.

Não versionar os valores secretos. Configurar primeiro no ambiente Preview.
O endpoint `POST /api/asaas-webhook` valida o token recebido no header `asaas-access-token`, registra o evento com ID único, e retorna 200 após a gravação. Eventos repetidos não geram duplicatas.

## Pendente antes de operar
1. Confirmar qual projeto Vercel hospeda a página de **vendas**: o repositório encontrado hoje contém a página-ponte de cadastro/grupo WhatsApp.
2. Configurar variáveis na Vercel da aplicação correta.
3. Criar checkout server-side com Asaas em **sandbox**: cadastro do cliente, pedido, cobrança avulsa ou parcelada e persistência dos IDs.
4. Implementar conciliação de pagamentos consultando o estado atual do Asaas; não marcar pedido como pago só ao receber um evento.
5. Para parcelamentos, conciliar **todas as parcelas** antes de concluir a quitação do pedido.
6. Configurar o webhook na conta Asaas com o token e a URL do endpoint, após homologar.
7. Testar duplicidade de eventos, requisições inválidas, cobrança falha e dados pessoais; revisar antes de fazer merge em main.

**Observação importante:** a oferta de 20x R$100 sem juros depende da modalidade e das condições efetivamente habilitadas na conta Asaas. Não presumir parcelamento gratuito sem conferir taxas.

Documentação: https://docs.asaas.com/docs/sobre-os-webhooks
