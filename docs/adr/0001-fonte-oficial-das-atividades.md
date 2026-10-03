# ADR 0001 — Fonte oficial das atividades

**Status:** aceita · **Data:** 2026-10-03

## Contexto

O pacote do case traz uma planilha inicial (`Ata_registro.xlsx`, aba `Atividades`) apontada pelo `INDEX.md` como "fonte inicial e provisória" dos registros `ACT-*`, atas que propõem mudanças e uma planilha vazia com nome parecido. O enunciado exige uma regra única e explicada para edições posteriores, sem "duas verdades silenciosas".

Alternativas consideradas:

1. **Planilha do Drive como registro operacional** (a aplicação escreve nela). Exigiria escopo de escrita no Drive (`drive`), contraria o princípio de menor privilégio do guia e cria corrida entre edições humanas na planilha e gravações da aplicação.
2. **Ler a planilha a cada sincronização e sobrescrever a base.** Simples, mas qualquer edição na planilha (ou uma planilha esvaziada) apagaria silenciosamente decisões tomadas na interface — exatamente o que o R10 proíbe.
3. **Importar uma vez para a base própria e tratar a planilha, depois disso, como fonte de propostas.** (escolhida)

## Decisão

- A planilha indicada pelo documento de índice é importada **uma vez** para o banco da aplicação (SQLite). O momento da importação, o arquivo, a aba, a linha de cada registro e a versão processada ficam guardados e visíveis.
- A partir daí, **o banco da aplicação é a fonte oficial**. Edições na interface valem imediatamente e entram no histórico com autor, hora, campos e motivo.
- Uma edição posterior no `.xlsx` é comparada com o retrato da importação; a diferença vira **sugestão pendente** (fonte: planilha, linha e valores). Linha nova vira sugestão de criação; linha removida ou planilha esvaziada abre **conflito**, e nada é apagado.
- Atas novas nunca alteram dados oficiais: geram sugestões que um revisor aceita, ajusta ou rejeita.
- Planilhas com formato de registro mas sem indicação no índice (ex.: `Ata - copia vazia.xlsx`) são marcadas como "sem autoridade", abrem conflito visível e não alteram atividades. Entre arquivos homônimos, vale o já importado — nunca o mais recente só por ser mais recente.

**Precedência** (a mesma escrita no `INDEX.md` do pacote, exibida na interface): decisão humana aprovada na aplicação > proposta de ata pendente > estado atual documentado > fonte ativa indicada no índice > arquivo antigo ou sem autoridade. Colisões que não podem ser resolvidas com segurança viram pendência humana.

## Consequências

- Uma única verdade operacional, auditável, que sobrevive a reinícios.
- A planilha histórica nunca é sobrescrita (a aplicação só lê o Drive).
- Custo: quem edita a planilha depois da importação precisa aprovar a sugestão gerada para que a mudança valha — comportamento intencional e explicado na tela "Estado da sincronização" e no "Comece aqui".
