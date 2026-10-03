# Diário de bordo

Registro curto de como o trabalho foi conduzido: decisões, mudanças de direção, verificações e limites.

## 2026-10-02 — Preparação

- Ambiente montado: Node.js 24 LTS (`node:sqlite` nativo, sem compilação no Windows) e Claude Code com o plugin **Everything Claude Code (ECC)**, que traz regras de código, revisão e TDD e hooks de proteção.
- Leitura completa do material: enunciado (o PDF tem duas exigências a mais que o `.md`: diário de bordo e execução local), especificação técnica, guia da Drive API e dados de teste. Também inspecionei as planilhas célula a célula.

## 2026-10-03 — Decisões de arquitetura

- **Stack:** TypeScript de ponta a ponta. Fastify no servidor, React + Vite na interface, SQLite no armazenamento, Zod compartilhado para validar API e formulários. Escolhi uma base pequena e bem testada em vez de várias camadas.
- **Fonte oficial** ([ADR 0001](adr/0001-fonte-oficial-das-atividades.md)): importar uma vez a planilha indicada pelo índice e tratar edições posteriores como sugestões. Descartei escrever no Drive (exigiria escopo de escrita) e reimportar a cada rodada (apagaria decisões em silêncio).
- **Sincronização** ([ADR 0002](adr/0002-sincronizacao-por-varredura.md)): varredura a cada 2 minutos, mais simples e robusta que webhook para o tamanho do acervo.
- **IA** ([ADR 0003](adr/0003-ia-com-validacao-deterministica.md)): Claude com saída estruturada e um leitor por regras com o mesmo contrato, ambos passando pelo mesmo validador. Assim o produto funciona e é testável sem chave de API.
- **Demonstração sem depender da minha conta:** criei um adaptador de "pasta local" que simula o Drive (`npm run demo`) e um script que reproduz os passos do pacote de teste.

## Construção e verificação

- Desenvolvimento incremental com testes a cada módulo: ingestão, analisador e validador, sincronização, revisão, atividades, resumo, API, Google (fake), Claude (fake), configuração e OAuth, interface. Ao final: 117 testes, cobertura de 89,0% das instruções e 92,8% das linhas.
- Validação manual no navegador: perfis, sugestão aceita por Bruno, histórico, "Comece aqui", sincronização, celular (375 px) e contraste. Medi todos os pares de cor: o menor contraste de texto é 5,5:1.

## Revisão independente

Pedi aos agentes `code-reviewer` e `security-reviewer` do ECC que revisassem o código já com todos os testes passando. Eles encontraram problemas reais que meus testes não cobriam.

- **O mais grave:** uma falha temporária de leitura da planilha oficial fazia as edições daquela versão se perderem em silêncio, porque a versão era marcada como "já comparada" usando o conteúdo antigo.
- **Na segurança:** a falta de checagem de `Origin` e `Host` deixava outro site aberto no navegador disparar ações contra `localhost`.

Segui TDD para cada achado:

1. escrevi o teste que reproduz o problema;
2. vi falhar (9 de 9 falharam);
3. corrigi;
4. vi passar.

A tabela completa está em [VALIDACAO.md](VALIDACAO.md).

## Uma decisão que mudei depois de ver uma saída incorreta

Ao escrever os testes da ata de 03/10, a primeira versão do leitor de responsáveis tratava qualquer nome seguido de verbo no futuro como responsável. "Bruno aprovará a versão final" fazia de Bruno o responsável por ACT-101, o que está errado: ele aprova, não executa. O mesmo risco existe com o modelo de linguagem. Mudei em três lugares:

1. O leitor por regras exclui verbos de aprovação.
2. O prompt do Claude diz explicitamente que "quem só aprova não é responsável".
3. O validador só aceita um responsável cujo nome aparece no trecho de evidência e que seja membro cadastrado.

Nenhuma dessas camadas confia sozinha nas outras.

Outra correção relevante: presumi que uma biblioteca popular leria a planilha do case, e não lia. Uma checagem no XML mostrou o formato com prefixo de namespace, e reescrevi o leitor (detalhes em [VALIDACAO.md](VALIDACAO.md)).

## Ferramentas de IA usadas

- **Para construir:** Claude Code (modelo Claude Opus 5.5) com o plugin ECC (regras de estilo, TDD e revisão, e o hook GateGuard, que pede justificativa antes de criar arquivos e rodar comandos destrutivos). Revisões finais feitas com os agentes `code-reviewer` e `security-reviewer` do ECC.
- **Dentro do produto:** Claude via API (opcional, `ANTHROPIC_API_KEY`) para ler atas e redigir o resumo pessoal, sempre atrás do validador determinístico. Sem chave, o leitor por regras assume.

## Fora do escopo e próximos passos

- Fora do escopo: OCR, vídeo, chat com documentos, notificações externas, SSO.
- Próximos passos para uso real:
  - autenticação Google por membro, com filtro por permissão de cada arquivo;
  - `changes.list` para acervos grandes;
  - um conjunto de avaliação com atas reais anonimizadas para medir precisão e cobertura do Claude.
