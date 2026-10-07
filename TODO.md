# TODO de execução — ProdutivaAI

## Fundação, sessão e privacidade

- Preservar o servidor e a estrutura OAuth do template.
- Completar o mapeamento de usuário/perfil e sessão persistente.
- Proteger `/dashboard`, `/chat`, `/projects`, `/projects/:id`, `/tasks`, `/search`, `/settings` e `/billing`.
- Implementar logout real e estados autenticado, desconectado, carregando e erro.
- Manter `SameSite=None; Secure` para `webdev_app_session` em Preview HTTPS cross-site, sem derivar a decisão de `req.secure` ou `NODE_ENV`.
- Filtrar todas as consultas privadas pelo usuário autenticado e, quando aplicável, por membro do projeto; IDs de outro usuário devem retornar erro seguro.

## Banco persistente e planos

- Adicionar migrações Drizzle determinísticas e aditivas para `profiles`, `plans`, `subscriptions`, `subscription_events`, `conversations`, `messages`, `projects`, `project_members`, `tasks`, `usage_logs`, `api_usage` e `settings`.
- Criar índices para usuário/data, conversa/data, projeto, status/prazo e busca conforme suporte do MySQL.
- Inserir somente os planos FREE, PRO e BUSINESS, sem usuários, projetos, conversas ou métricas de demonstração.
- O plano atual deve vir de `subscriptions` com fallback FREE, nunca de input do navegador; limites e preços devem vir do banco.

## Backend modular e segurança

- Organizar módulos de auth, banco/ownership, IA, billing, Mercado Pago, busca, routers tRPC e endpoints HTTP.
- Validar todos os inputs tRPC com zod, impor limites de tamanho e rate limiting nos endpoints de IA, busca, autenticação e webhook.
- Retornar erros seguros sem stack traces.
- Nunca enviar API keys, secrets, tokens privados ou credenciais do banco ao frontend.
- Criar `.env.example` apenas com nomes e explicações, sem valores.

## Chat e IA real

- Criar conversa vazia e derivar o título da primeira mensagem sem inventar conteúdo.
- Listar histórico com paginação/cursor e mensagens por conversa em páginas.
- No envio: validar ownership, verificar plano/limite, salvar mensagem do usuário, chamar LLM real, salvar resposta somente se houver conteúdo válido e registrar uso com sucesso/erro.
- Usar contexto limitado da conversa e instruções do projeto/modo sem expor prompts secretos.
- Implementar cancelamento/abort quando possível, tratar timeout, indisponibilidade, rate limit, autenticação inválida, resposta vazia e erro de limite.
- Suportar copiar, renomear, excluir, continuar e estados loading/empty/error/success.
- Renderizar Markdown com segurança.
- Mostrar exatamente: “Você atingiu o limite do seu plano. Faça upgrade para continuar.”, com botões funcionais.
- Ferramentas reais: resumir, analisar, explicar, melhorar texto, gerar ideias, planejar e reescrever.
- Modos Estudos: explicar, resumir, perguntas, exercícios, plano de estudos e passo a passo.
- Modos Trabalho: e-mails, documentos, ideias, tarefas, planos, resumos, melhoria e análise.
- Manter entrada em caso de erro e permitir retry sem duplicar mensagens.

## Projetos, tarefas e busca

- Implementar projetos com criação, edição, exclusão, descrição, instruções, conversas e tarefas.
- Implementar membros com autorização por projeto; convite/colaboração pode ficar limitado a usuários já autenticados na primeira entrega.
- Implementar tarefas CRUD com status `todo`, `in_progress`, `done`, prioridades baixa/média/alta, filtros, pesquisa, prazo e projeto opcional.
- Implementar busca global paginada em conversas, títulos, mensagens, projetos e tarefas, filtrada pelo usuário e com debounce no frontend.
- Nunca preencher estados vazios com dados de exemplo.

## Dashboard, configurações e billing

- Dashboard deve usar somente agregados reais do banco: conversas, mensagens, projetos, tarefas, concluídas e uso de IA; conta nova deve exibir zeros do banco.
- `/settings` deve permitir perfil, preferências de tema/idioma/comportamento, conta/sessão, IA e resumo da assinatura.
- `/billing` deve mostrar plano atual, uso, limite, percentual, status, histórico e CTAs conforme plano.
- Free mostra PRO e BUSINESS; PRO mostra BUSINESS; BUSINESS mostra “Você está no melhor plano.”.
- Os links devem ser exatamente `https://mpago.la/14CRH6L` (PRO) e `https://mpago.la/2dbzEGa` (BUSINESS).

## Mercado Pago sem simulação

- Preparar `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` e identificadores/configuração de webhook necessários como secrets.
- `POST /api/mercadopago/webhook` deve validar assinatura/cabeçalhos e corpo, deduplicar por ID de evento, consultar a API do Mercado Pago, confirmar status real e identificar usuário/plano.
- Somente pagamento aprovado/assinatura ativa confirmada pode atualizar `subscriptions` para `active`.
- `pending`, `rejected`, `cancelled`, `expired` e equivalentes não ativam plano.
- Registrar histórico, aceitar reentrega como no-op e não expor detalhes.
- Como os links são checkouts fixos, ativação automática só pode ocorrer quando metadata/referência suportada relacionar com segurança pagamento, usuário e plano; caso contrário, permanecer desabilitada sem fingir funcionamento.

## Rotas, interface e acessibilidade

- Implementar `/`, `/login`, `/register`, `/dashboard`, `/chat`, `/projects`, `/projects/:id`, `/tasks`, `/search`, `/settings` e `/billing`, mais `public/manus-routes.json` sincronizado.
- Landing com ProdutivaAI, slogan, CTA “Começar agora”, recursos e planos sem prometer recursos indisponíveis.
- Login/register devem usar Manus OAuth real e exibir estados de sessão.
- App shell com rail desktop, drawer mobile, contexto, busca global e menu de conta.
- Chat com composer confortável, ferramentas, mensagens e painel contextual; no mobile, chat em tela cheia.
- Todas as telas devem possuir loading, empty, error e success explícitos.
- Garantir foco, labels/aria, contraste e áreas de toque adequadas.

## Diagnóstico, testes e auditoria

- Confirmar diagnóstico TypeScript host-managed em `runtime/post-edit` antes das grandes edições.
- Executar e corrigir `pnpm check`, `pnpm test`, `pnpm build`, `/api/health` e `/manus-routes.json`.
- Adicionar testes de auth/logout, ownership, limites, planos, idempotência de webhook e parsing de IA.
- Auditar contra mocks, métricas hardcoded, respostas pré-programadas, chaves no client, bypass de auth, mutações sem ownership, ativação por frontend e botões sem handler.
- Verificar desktop/mobile em Preview quando houver defeito concreto e corrigir tudo que for confirmado.

## Critério de conclusão

O projeto só estará concluído quando iniciar sem erros, banco e migrações funcionarem, login/proteção/isolamento estiverem ativos, chat usar IA real quando configurado, dados persistirem, limites e planos vierem do banco, billing refletir a assinatura real, links abrirem os checkouts exatos, ativação depender somente de webhook Mercado Pago confirmado, estados e responsividade funcionarem e as auditorias TypeScript, testes, build e anti-mock passarem.
