# ADR 0002 — Sincronização por varredura periódica da pasta

**Status:** aceita · **Data:** 2026-10-03

## Contexto

O R03 exige detectar arquivos novos e edições na pasta configurada (e subpastas) em até 15 minutos, com a aplicação rodando, mais um botão manual. O guia oferece `files.list`, `changes.list` (com token) e `changes.watch` (webhook).

## Decisão

Varredura periódica da árvore da pasta com `files.list` (filhos diretos por pasta, todas as páginas, conjunto de pastas visitadas), a cada **120 s** por padrão (`SYNC_INTERVAL_SECONDS`, 15–600 s).

- **Novo ou editado:** comparo o `version` do Drive com o último processado; só baixo/exporto o que mudou. A análise por IA só roda quando o **hash do texto** muda (nova versão com o mesmo texto não reanalisa).
- **Idempotência:** fonte = `file_id`; sugestão = impressão digital (arquivo + tipo + alvo + campos propostos). O mesmo evento duas vezes não duplica nada.
- **Renomeado:** o `file_id` do Drive é estável; o nome é atualizado sem duplicar.
- **Removido, movido para fora da pasta ou acesso revogado:** o arquivo some da listagem → marcado **indisponível**, o texto em cache é apagado e as sugestões pendentes que dependiam dele são retiradas. Referências de atividades passam a mostrar "fonte indisponível".
- **Falhas:** erro em um arquivo marca só esse arquivo como "falhou" (mantendo a última leitura, sinalizada como possivelmente desatualizada); erro de autorização (401/`invalid_grant`) interrompe a rodada, preserva o último estado confirmado e pede reconexão. Erros temporários (429/5xx/rede) têm 3 tentativas com espera exponencial; rodadas que falham dobram o intervalo até no máximo 10 min.
- **Concorrência:** pedidos simultâneos (botão + agendador) compartilham a mesma rodada.

## Por que não `changes.list`/webhook

Para uma pasta de dezenas de arquivos, a varredura custa poucas chamadas por rodada, detecta remoção e perda de acesso naturalmente (o arquivo deixa de aparecer) e não exige infraestrutura pública para webhook nem renovação de canal. `changes.list` reduziria chamadas em acervos grandes; o desenho isola a fonte de mudanças no `DriveGateway`, então trocar a estratégia não afeta o resto.

## Consequências

Detecção típica em até ~2 minutos (bem dentro dos 15). O custo de API cresce com o número de pastas; para o acervo real da Liga, migrar para `changes.list` com token salvo é o próximo passo natural.
