# Supabase — configuração para FB Peninga

1. Criar projeto em https://supabase.com/dashboard com região do Brasil ou mais próxima disponível.
2. Em SQL Editor, executar `supabase/schema.sql`. **Não inserir dados reais de compradores em testes.**
3. Em Project Settings > API, copiar Project URL e **service_role secret** diretamente para Vercel (nunca GitHub/chat):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Selecionar apenas ambiente Preview inicialmente para as credenciais do projeto de testes.
5. NÃO expor a service role em HTML, prefixos VITE_/NEXT_PUBLIC_, ou mensagens ao comprador.
6. Testar que tabela está vazia, RLS habilitado, sem políticas públicas; a conta anônima não pode ler linhas.
7. Para produção, configurar variáveis no escopo Production somente após revisão e testes completos.

Estado: apenas esquema SQL criado. A cobrança Asaas ainda está intencionalmente bloqueada. Confirmar com os proprietários o prazo de vencimento do primeiro boleto e política de tratamento de dados antes de ativar.
