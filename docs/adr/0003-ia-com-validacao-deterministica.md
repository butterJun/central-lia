# ADR 0003 — IA que propõe, validação determinística que decide o que pode ser proposto

**Status:** aceita · **Data:** 2026-10-03

## Contexto

O case pede IA para (1) ler atas e sugerir criação/atualização de atividades com evidência e (2) resumir o que mudou para cada membro — sem inventar prazo ou responsável, sem transformar hipóteses em tarefas e tratando o texto dos documentos como dado (inclusive quando contém instruções).

## Decisão

1. **Contrato único** (`src/server/suggestions/contract.ts`), equivalente à seção 6 da especificação: `kind`, `target_activity_id`, `title`, `owners`, `due_date`, `next_step`, `status`, `evidence`, `reason`, `uncertainties`.
2. **Dois leitores com o mesmo contrato:**
   - **Claude** (`AI_MODEL`, padrão `claude-haiku-4-5`, o modelo atual mais econômico; esforço `low` nos modelos que aceitam o parâmetro) via *structured outputs* com esquema Zod. O documento vai dentro de `<documento>` e o prompt de sistema diz que ele é dado, não instrução.
   - **Leitor por regras** (determinístico), usado quando não há chave, quando a API falha ou quando o modelo recusa. Ele reconhece IDs `ACT-*`, "Fulano + verbo no futuro", datas ISO, "Próximo passo:", "de X para Y" e palavras de hipótese ("talvez", "ninguém assumiu").
3. **Validador determinístico obrigatório** (`validator.ts`) para as duas saídas. Uma proposta só vira sugestão se:
   - a evidência existir **literalmente** no documento;
   - o ID alvo existir;
   - cada valor for rastreável ao trecho (prazo escrito na evidência, responsável nomeado e cadastrado, mudança de estado explícita).
   Valores não rastreáveis são **descartados e listados como incertezas**. Propostas que não mudam nada são descartadas. Hipóteses nunca viram criação. Possíveis duplicatas são sinalizadas. Atas mais antigas que a última alteração aprovada recebem aviso.
4. **Revisão humana sempre:** sugestões têm ciclo próprio (`pendente → aceita | ajustada | rejeitada`, e `substituída` quando o documento muda). Só perfis revisores aplicam. Aplicar duas vezes ou por cima de uma edição humana mais nova é recusado.
5. **Resumo pessoal:** os fatos vêm sempre dos registros, em listas separadas (confirmado, proposto, incerto). O texto corrido (Claude, ou modelo fixo sem IA) é opcional e passa por uma checagem: se citar data que não está nos registros, é descartado e o modelo fixo é usado.

## Consequências

- O produto funciona e é avaliável sem chave de API. Com chave, Claude amplia a cobertura de redações variadas.
- Mesmo uma saída errada ou manipulada do modelo não chega ao banco sem passar pelas mesmas regras e por um humano.
- Limite conhecido: o leitor por regras só entende padrões explícitos. Atas escritas de forma muito livre, sem chave de API, geram menos sugestões, mas nunca sugestões sem lastro.
