# Central da Liga IA — contexto, onboarding e atividades

A Central da Liga IA é uma aplicação web para a Liga de Inteligência Artificial da UFSCar. Ela lê a pasta de trabalho da Liga no Google Drive (atas, planilha de atividades e documentos de direção) e responde a duas perguntas de cada membro:

- **"O que preciso fazer agora?"** Atividades com responsável, prazo, estado, próximo passo e fonte, com filtros e visão pessoal.
- **"O que mudou desde a última vez?"** Documentos novos ou alterados no Drive viram **sugestões verificáveis**, com o trecho literal e o link do original. Uma pessoa revisora aceita, ajusta ou rejeita cada uma, e o resumo pessoal separa fatos confirmados de propostas.

## Principais recursos

- **Sincronização automática com o Google Drive:** acesso somente leitura à pasta configurada e às subpastas, com detecção de arquivos novos, editados, renomeados, removidos ou sem acesso.
- **Registro oficial de atividades:** criação e edição pela interface, com histórico completo (autor, hora, campos alterados e fonte) e proteção contra edições simultâneas.
- **Leitura assistida de atas com IA (Claude):** propõe criar ou atualizar atividades e nunca altera nada sem revisão humana. Um validador determinístico rejeita evidências inventadas, prazos ou responsáveis não escritos no texto e hipóteses vagas.
- **Regras de autoridade:** a planilha indicada pelo índice é a fonte inicial; planilhas parecidas, vazias ou contraditórias geram conflitos visíveis, nunca apagam dados.
- **"Comece aqui":** página para quem acaba de chegar, montada a partir dos documentos de direção, com o que ainda está "a confirmar" marcado como tal.
- **Resumo "o que mudou para mim":** separa confirmado, proposto e incerto, sempre com links para as fontes.
- **Interface acessível:** contraste WCAG AA medido, navegação por teclado, uso no celular e a identidade visual da Liga.

---

## Experimente em 2 minutos (modo demonstração, sem Google)

Requisitos: **Node.js 22.13 ou superior** (testado com 24 LTS).

```bash
npm install
```

```bash
npm run demo
```

Abra **http://localhost:4000**. O modo demonstração usa a pasta local `demo-drive/` no lugar do Drive e carrega **dados de exemplo** da Liga (em `fixtures/drive/`): pessoas, atividades e atas criadas para teste. Com o servidor rodando, simule novos documentos em outro terminal; eles são detectados pela sincronização automática (2 min) ou pelo botão **Sincronizar agora**:

```bash
npm run demo:drive add-minutes
```

Esse passo adiciona duas atas novas. Uma delas entra como Google Docs nativo simulado (`.gdoc`), e o `.docx` original aparece como "não processado".

```bash
npm run demo:drive add-conflict
```

Esse passo adiciona uma planilha vazia com nome parecido com o registro oficial.

```bash
npm run demo:drive edit-minutes
```

Esse passo edita uma ata já conhecida.

`npm run demo` recria a pasta e o banco da demonstração a cada execução; `npm run demo:start` reinicia **mantendo** os dados. Para parar o servidor de qualquer terminal, use `npm run stop`: ele encerra o processo da Central na porta configurada (padrão 4000) e não mexe em outro programa que esteja nessa porta. Para desenvolvimento com recarga automática, use `npm run dev` (interface em http://localhost:5173).

### Tour guiado

1. **Comece aqui** como "Novo membro": propósito marcado como provisório, frentes, fonte das atividades, regra de precedência e lacunas.
2. Como **Ana**: visão geral e "Minhas atividades" (ACT-101 e ACT-104). Troque para **Davi** e veja a lista mudar sem alterar os dados.
3. `npm run demo:drive add-minutes` e depois **Sincronizar agora**:
   - em **Sugestões para revisar** aparece "Atualizar ACT-101 (05/10 → 07/10)", com o trecho da ata;
   - ACT-101 ainda mostra 05/10 e "Atualização pendente";
   - a ideia "Talvez possamos publicar…" não virou tarefa.
4. Como **Bruno**, aceite a sugestão. ACT-101 passa a 07/10, com histórico e as duas fontes.
5. Crie uma atividade em **Todas as atividades → Nova atividade**. Pare o servidor (Ctrl+C), suba de novo com `npm run demo:start` (mantém o banco) e recarregue: a atividade continua lá, com autor e histórico.
6. `npm run demo:drive add-conflict`: as atividades continuam e o conflito aparece em **Estado da sincronização**.
7. Em **Novidades dos documentos**, compare o resumo de Ana e o de Davi.

---

## Conectar ao Google Drive

1. **Google Cloud:**
   - crie um projeto e ative a **Google Drive API** (APIs e serviços › Biblioteca);
   - em **Google Auth Platform**, configure a tela de consentimento. Para uso interno de uma organização Google Workspace, escolha **Interno**. Com contas pessoais, escolha **Externo** em modo **Testing** e cadastre cada pessoa em **Público-alvo › Usuários de teste**;
   - crie um cliente OAuth do tipo **Aplicativo da Web**.
2. No cliente OAuth, cadastre a origem e o redirecionamento do endereço onde a Central vai rodar. Para uso local:
   - origem: `http://localhost:4000`
   - URI de redirecionamento: `http://localhost:4000/auth/google/callback`
3. Identifique a pasta da Liga no Drive. O ID é o trecho final da URL `drive.google.com/drive/folders/<ID>`. Para testar antes de usar a pasta real, crie uma pasta e envie o conteúdo de `fixtures/drive/01_CARGA_INICIAL`.
4. Crie o arquivo de configuração:

   ```bash
   cp .env.example .env
   ```

   Preencha `DRIVE_MODE=google`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `DRIVE_TEST_FOLDER_ID` e `APP_SECRET`. Para gerar o `APP_SECRET`:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Para ativar a leitura de atas com IA, preencha também `ANTHROPIC_API_KEY`.

5. Compile e inicie:

   ```bash
   npm run build
   ```

   ```bash
   npm start
   ```

6. Abra **Estado da sincronização → Conectar Google Drive** e autorize. Se o Google responder `403 access_denied`, a conta não está em **Público-alvo › Usuários de teste**: adicione-a e confira se ela aparece na lista depois de salvar. A partir daí, documentos adicionados ou editados **diretamente no Drive** aparecem na Central. Arquivos Word (`.docx`) precisam ser convertidos em Google Docs no próprio Drive.

Detalhes do acesso:

- **Escopo:** apenas `drive.readonly`. O código lê somente a pasta configurada e as subpastas.
- **Tokens:** ficam só no servidor, criptografados (AES-256-GCM) com `APP_SECRET`, no banco local em `data/`, que está fora do Git. A tela nunca mostra credenciais.
- **Expiração:** com o app em "Testing", o Google expira o refresh token em 7 dias. A interface avisa e oferece reconectar.
- **Revogar:** botão "Desconectar", ou em myaccount.google.com/connections. Para apagar as cópias locais, remova a pasta `data/`.

---

## Arquitetura em linguagem simples

```
 Google Drive (pasta de teste)            Navegador (React)
        │  só leitura                         │  /api (JSON)
        ▼                                     ▼
 ┌──────────────┐   arquivos novos/   ┌──────────────────────────┐
 │ Sincronizador │──► alterados ─────►│ Leitura por formato       │ .md · Google Docs · .xlsx
 │ (a cada 2 min │                    │ (texto, planilha, PDF)    │ · Google Sheets · PDF c/ texto
 │  + botão)     │                    └────────────┬─────────────┘
 └──────────────┘                                  │
                         ┌─────────────────────────┼────────────────────────────┐
                         ▼                         ▼                            ▼
              Regras de autoridade        Leitor de atas (IA ou regras)   Documentos de direção
              (qual planilha vale)        → validador determinístico      → "Comece aqui"
                         │                         │
                         ▼                         ▼
              Registro oficial (SQLite) ◄── Sugestões pendentes ◄── revisão humana
              atividades · histórico · fontes · conflitos
```

- **Servidor (`src/server`)**: Fastify + SQLite nativo do Node. Organizado em gateways (Drive Google ou pasta local), ingestão por formato, repositórios (padrão *Repository*), serviços de domínio e rotas HTTP. As dependências são montadas num único *composition root* (`container.ts`).
- **Interface (`src/web`)**: React + TanStack Query. Mostra os últimos dados mesmo sem conexão e avisa quando estão desatualizados.
- **Compartilhado (`src/shared`)**: tipos de domínio, datas (fuso `America/Sao_Paulo`) e esquemas Zod, usados tanto pela API quanto pelos formulários.

---

## Fonte oficial das atividades

Decisão completa em [docs/adr/0001](docs/adr/0001-fonte-oficial-das-atividades.md).

1. A planilha **indicada pelo `INDEX.md`** (`Ata_registro.xlsx`, aba `Atividades`) é importada **uma vez**. O momento, o arquivo, a linha e a versão ficam visíveis em "Estado da sincronização" e no histórico de cada atividade.
2. Daí em diante, **o banco da aplicação é a fonte oficial**. Edições pela interface valem imediatamente e ficam no histórico (autor, hora, campos e motivo).
3. Edições posteriores no `.xlsx` e atas novas **nunca sobrescrevem**: viram **sugestões**. Uma linha removida ou uma planilha esvaziada abre **conflito**, e nada é apagado.
4. Planilhas sem indicação no índice, como `Ata - copia vazia.xlsx`, são "sem autoridade": abrem conflito e não alteram atividades.

**Precedência:** decisão humana aprovada na aplicação > proposta de ata pendente > estado atual documentado > fonte indicada no índice > arquivo antigo ou sem autoridade.

---

## Sincronização

Detalhes em [docs/adr/0002](docs/adr/0002-sincronizacao-por-varredura.md).

- **Intervalo:** varredura da pasta e das subpastas a cada **120 s** (`SYNC_INTERVAL_SECONDS`), além do botão "Sincronizar agora". A detecção típica leva menos de 2 minutos, bem dentro do alvo de 15.
- **Idempotência:** só relê o que mudou (`version` do Drive), e só reanalisa quando o texto muda (hash). O mesmo evento repetido não duplica fontes nem sugestões.
- **Arquivo renomeado:** o ID é preservado.
- **Removido, movido para fora da pasta ou sem acesso:** a fonte fica "Indisponível", o cache é apagado, as sugestões pendentes são retiradas e as atividades mostram "fonte indisponível".
- **Documento editado:** é relido; as sugestões que a versão nova não sustenta viram "substituídas".
- **Falha em um arquivo:** só ele fica "Falhou", com o motivo; a última leitura é mantida e sinalizada.
- **Falha de autorização:** a rodada é interrompida, o último estado confirmado é preservado e a interface pede reconexão.
- **Erros temporários (429, 5xx, rede):** 3 tentativas com espera exponencial; rodadas que falham dobram o intervalo até no máximo 10 min.

## Formatos suportados

| Formato | Situação |
|---|---|
| Markdown `.md` | Lido, preservando títulos e seções |
| Google Docs nativo | Exportado como Markdown (texto puro como alternativa) |
| `.xlsx` | Lido por um leitor próprio, compatível com planilhas de namespace prefixado |
| Google Sheets nativo | Exportado como `.xlsx` |
| PDF com texto selecionável | Lido (diferencial) |
| PDF digitalizado, imagens, vídeo e áudio | "Formato ainda não processado", com o motivo (OCR e transcrição estão fora do escopo) |
| Word `.docx` | "Não processado", com a instrução de converter para Google Docs no Drive |

---

## IA no fluxo de trabalho

Detalhes em [docs/adr/0003](docs/adr/0003-ia-com-validacao-deterministica.md).

- **Leitura assistida de atas:**
  - com `ANTHROPIC_API_KEY`, usa Claude com saída estruturada. O modelo padrão é o **Claude Haiku 4.5** (`claude-haiku-4-5`), o mais econômico da linha atual: extrair campos de atas curtas não exige raciocínio profundo, e o validador determinístico compensa erros eventuais. Outro modelo pode ser escolhido em `AI_MODEL` (nos modelos que aceitam, usa esforço baixo);
  - sem chave, se a API falhar ou se o modelo recusar, usa um leitor por regras com o mesmo contrato.
- **Validador determinístico:** toda proposta passa por ele.
  - A evidência precisa existir **literalmente** no documento.
  - A atividade alvo precisa existir.
  - Prazo e responsável só são aceitos se estiverem escritos no trecho; senão, ficam como "a definir" e a incerteza é registrada.
  - Hipóteses ("talvez", "ninguém assumiu") nunca viram tarefa.
  - Propostas que não mudam nada são descartadas, e possíveis duplicatas são sinalizadas.
  - O texto dos documentos é tratado como dado: instruções escritas numa ata não são seguidas.
- **Resumo "o que mudou para mim":** os fatos vêm dos registros, separados em confirmados, propostas pendentes e incertos, sempre com links. O texto corrido é opcional, escrito por Claude ou por um modelo fixo, e é descartado se citar uma data que não está nos registros.
- **Revisão:** só perfis revisores (Bruno e Carla) aplicam sugestões. Aplicar duas vezes, aplicar uma sugestão substituída ou aplicar por cima de uma edição humana mais nova é recusado.

### Custo estimado por uso (Claude Haiku 4.5: US$ 1 por milhão de tokens de entrada e US$ 5 por milhão de saída)

| Operação | Tokens aproximados | Custo aproximado |
|---|---|---|
| Ler uma ata nova ou alterada | 2–4 mil de entrada e 0,5–1,5 mil de saída | US$ 0,005–0,012 |
| Resumo em texto (sob demanda) | ~2 mil de entrada e ~0,4 mil de saída | ~US$ 0,004 |
| Mês típico da Liga (30 documentos e 200 resumos) | — | ~US$ 1 |

A análise só roda quando o texto de um documento muda. Para comparação, o mesmo mês custaria cerca de US$ 2 com o Claude Sonnet 5.5 (`claude-sonnet-5-5`) e cerca de US$ 5 com o Claude Opus 5.5 (`claude-opus-5-5`). Sem chave, o custo é zero e o produto usa o leitor por regras.

---

## Perfis de demonstração

| Perfil | Frente | Papel |
|---|---|---|
| Ana | Growth | Membro (ACT-101, ACT-104) |
| Bruno | Growth | Líder e **revisor** |
| Carla | Formação | Membro e **revisora** (ACT-103) |
| Davi | Operações | Membro (ACT-102, ACT-104) |
| Novo membro | — | Quem acabou de chegar (sem atividades) |

A troca de perfil é uma seleção explícita no topo da página (cabeçalho `x-demo-user`), **não é autenticação**.

---

## Qualidade e testes

```bash
npm run check
```

Esse comando roda typecheck, testes e build.

```bash
npm run test:coverage
```

- 123 testes automatizados: ingestão dos arquivos de exemplo, analisador e validador (incluindo injeção de prompt), sincronização ponta a ponta, revisão, persistência após reinício, resumo, onboarding, API HTTP, adaptador Google (cliente falso), Claude (cliente falso), OAuth, agendador e componentes da interface.
- Cobertura do servidor: **89,0%** das instruções e **92,7%** das linhas.
- Acessibilidade:
  - contraste medido (o menor par de texto é 5,5:1);
  - foco visível e navegação por teclado, com link "pular para o conteúdo";
  - rótulos em todos os campos e erros em texto ligados ao campo;
  - estados sempre com símbolo e palavra;
  - tabela que vira cartões no celular.
- Registro dos casos validados: [docs/VALIDACAO.md](docs/VALIDACAO.md). Diário do processo: [docs/DIARIO_DE_BORDO.md](docs/DIARIO_DE_BORDO.md).

## Limitações conhecidas

- **IA:** a leitura de atas e o resumo foram validados com o Claude Haiku 4.5 e com o Google Drive reais (veja [docs/VALIDACAO.md](docs/VALIDACAO.md)), mas com poucos documentos. Antes de confiar em escala, vale montar um conjunto de atas reais anonimizadas para medir a precisão.
- **Leitor por regras:** só entende padrões explícitos (IDs, nomes com verbo no futuro, datas ISO, "Próximo passo:"). Atas muito livres, sem chave de API, geram menos sugestões, mas nunca sugestões sem lastro.
- **Datas relativas:** "até sexta" fica como prazo a definir (decisão intencional da especificação).
- **Modo pasta local:** renomear um arquivo gera um ID novo. No Drive real o ID é estável.
- **Autorização:** sem autenticação real e sem filtro de visibilidade por pessoa. Todos os perfis veem todos os documentos da pasta.
- **Escala:** a varredura completa da pasta serve a dezenas ou centenas de arquivos; acervos grandes pedem `changes.list`.

## Antes de usar dados reais da Liga

1. **Autenticação de verdade:** login Google de cada membro (OpenID Connect), sessão no servidor e papéis (membro e revisor) definidos pela organização, no lugar do seletor de perfil.
2. **Permissões coerentes com o Drive:** consultar `permissions` de cada arquivo, ou operar com o token de cada usuário, e filtrar trechos, sugestões e resumos pelo que cada pessoa pode ver.
3. **OAuth em produção:** verificação do app no Google (o `drive.readonly` é escopo restrito), HTTPS, avaliação de segurança e política de retenção.
4. **Dados e IA:** acordo de processamento com o provedor de IA, minimização do texto enviado e opção de desligar a IA por pasta.
5. **Operação:** segredos em um gerenciador (não em `.env`), backup e criptografia do banco, logs sem conteúdo de documentos, rotina para apagar o cache quando uma fonte for removida (já implementado) e para revogar tokens.
6. **Avaliação:** um conjunto de atas reais anonimizadas para medir a precisão das sugestões antes de liberar.

## Estrutura

```
src/shared/        tipos de domínio, datas, esquemas Zod (API + formulários)
src/server/
  drive/           gateways: Google Drive (OAuth, files.list/export) e pasta local
  ingestion/       leitura por formato, metadados de atas, regras de autoridade
  activities/      serviço de atividades e importador do registro
  suggestions/     contrato, leitor Claude, leitor por regras, validador, revisão
  sync/            sincronizador e agendador
  digest/          "o que mudou para mim" e texto do resumo
  onboarding/      "Comece aqui"
  repositories/    acesso ao SQLite
  http/            rotas Fastify
src/web/           interface React (páginas, componentes, estilos)
tests/             testes (Vitest)
fixtures/drive/    dados de exemplo para demonstração e testes
scripts/           preparação da pasta de demonstração
docs/              ADRs, registro de validação, diário de bordo
```

## Ferramentas de IA

- **No desenvolvimento:** Claude Code (Claude Opus 5.5) com o plugin Everything Claude Code (regras, TDD, revisão e hooks de proteção).
- **No produto:** Claude via API (opcional) para ler atas e escrever o resumo, sempre atrás de validação determinística e revisão humana.
