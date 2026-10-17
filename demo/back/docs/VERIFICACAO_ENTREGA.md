# Verificação da entrega · 17/10/2026

Esta revisão corrige a documentação e o pacote de entrega, sem alterar regras de cálculo. A base Git durante a validação era `eec87e541ab1e2cb124e34f32535eabc72f8596c`, com alterações locais ainda não commitadas naquele momento. O [manifesto oficial](../../../saida/manifesto.json) registra os hashes dos arquivos executados; o identificador do commit base sozinho não representa as correções locais testadas.

## Procedimento

Uma cópia separada recebeu os arquivos versionados e os novos arquivos da revisão, com seus conteúdos atuais. Não recebeu `.git`, ambientes Python, `node_modules`, builds nem bancos locais. A instalação partiu dessa cópia, usando Python 3.13.7, Node.js 26.10.0 e npm 11.19.1. Os testes da interface, sua compilação e a verificação de inicialização incluíram as 24 alterações locais que já existiam no início; elas foram preservadas e ficam fora do commit das correções de entrega. Esses resultados descrevem o snapshot local testado, não uma verificação isolada do novo commit. Os hashes de código do manifesto cobrem o backend, suas dependências e os launchers, não a interface.

O comando `./entrega.sh` instalou o lock Python, criou banco temporário novo, importou as seis fontes de setembro, recalculou a competência explícita e validou o pacote antes de publicar. Uma segunda geração independente foi comparada byte a byte com os seis CSVs da raiz: todos coincidiram. Horário de geração e metadados Git do manifesto podem variar; não fazem parte da igualdade dos CSVs financeiros.

## Resultados confirmados

| Verificação | Resultado |
|---|---|
| Instalação Python limpa e exportação | Passaram |
| Suíte completa do backend | 351 testes em 43 classes: todos passaram, sem falhas, erros ou testes pulados |
| Instalação da interface com `npm ci` | Passou |
| Testes da interface | 155 testes, 23 arquivos, passaram |
| Compilação TypeScript/Vite | Passou |
| Servidor iniciado pelo launcher com banco/runs/credenciais temporários | `/`, `/pipeline`, `/api/health` e `/api/state` responderam 200 |
| Saúde do servidor | `ok=true`, `gmail_configured=false`, competência 2026-09 e `trace_ok=true` |
| CSVs oficiais | 35 comissões, 237 divergências, 21 notas, 184 lançamentos e 295 pendências |
| Rastro | 772 valores conhecidos conciliados exatamente com 5.226 linhas; referências e linhas físicas conferidas |
| Preservação | 102 arquivos de fontes e saídas históricas comparados ao início da revisão: nenhum hash alterado |
| Alterações anteriores da interface | Conteúdo preservado durante esta revisão |
| Links locais | 141 links e referências de linha dos documentos novos ou modificados conferidos |
| Transcripts | 56 sessões, 8.030 eventos, JSONL e hashes conferidos |
| Credenciais | Nenhuma correspondência com os padrões conhecidos de chaves privadas/tokens nos 112 arquivos textuais novos ou modificados examinados; não é garantia de detecção universal |

A suíte do backend foi descoberta com `unittest` e executada por classes inteiras em quatro cópias independentes, cada uma com os mesmos 432 arquivos da cópia limpa. Os processos compartilharam somente o intérprete e as dependências recém-instaladas; fontes, bancos, credenciais e demais arquivos de teste ficaram isolados por cópia. A união dos resultados contém exatamente os 351 testes descobertos, sem duplicatas, faltantes, falhas esperadas ou sucessos inesperados. Os 43 processos terminaram com código zero em 280,329 segundos de tempo total; os hashes dos 432 arquivos permaneceram iguais em cada cópia. As execuções sequenciais anteriores foram interrompidas para acelerar a verificação e não são contadas como aprovação. O comando documentado `./demo/back/run.sh test` executa essa mesma suíte sequencialmente.

Os 13 testes do novo publicador passaram também dentro dessa execução completa. Cobrem repetição com banco novo, hashes adulterados, referências inventadas, IDs duplicados, rastro ausente, exposição parcialmente desconhecida, competência sem movimentos, preservação de histórico, diretório indevido no lugar de CSV, destino por link simbólico, alteração concorrente do histórico, falha de disco simulada e interrupção logo após cada troca de diretório. Dados desconhecidos permanecem desconhecidos; a validação não os converte em zero.

O launcher foi exercitado em instalação limpa e em casos isolados de intérprete ausente, ambiente incompleto e versão incompatível. Para o caso 3.14, o teste do guarda usou um executável simulado; a ausência de wheel do PyArrow 20 para essa versão foi verificada separadamente. Ambientes existentes foram preservados. Windows não foi revalidado nesta revisão.

## Por que a entrega anterior tinha contagens diferentes

Os arquivos antigos em `saida/setembro_2026/` e `demo/back/saida/` permanecem como registros históricos: continham 304 pendências, 57 bloqueantes e 5.179 rastros. No código atual, 57 ocorrências da Atlas se agrupam em uma pendência por empresa, entram 38 alertas de bandeira e nove ocorrências de original histórico ausente: `304 − 56 + 38 + 9 = 295` pendências; os bloqueantes passam a `57 − 56 + 9 = 10`.

Os totais financeiros permanecem iguais: checkout R$ 207.039,73; remessas R$ 39.543,45; notas R$ 246.588,68; divergências assinadas R$ 14.826,55. Essas contagens não foram impostas ao motor como gabarito. O novo comando publica diretamente na raiz; o antigo `run.sh export` continua representando o cadastro local em `demo/back/saida/`.

## Limites e pendências

- Não houve consulta ao gabarito oficial, homologação ERP, emissão fiscal, aprovação financeira nem envio real de e-mail.
- O teste de inicialização e rotas não equivale a uma navegação completa por todos os fluxos da interface.
- Os transcripts são um snapshot local, com corte às 17h20m45s. Histórico Claude Code, sessões dos demais integrantes e ações posteriores ao corte ainda exigem os registros originais; veja [PROMPTS/README.md](../../../PROMPTS/README.md).
- As mídias binárias dos transcripts têm hashes/referências, sem transcrição inventada. O histórico integral de todo o time não está comprovado.
- A validação não incluiu push ou envio à organização. O commit local das correções de entrega foi autorizado posteriormente pelo usuário.
