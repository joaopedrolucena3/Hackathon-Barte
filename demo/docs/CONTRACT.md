# Contrato interno do MVP

Aplicação local Python + SQLite + HTML/CSS/JS sem build. Servidor em 127.0.0.1:8765.

## Motor (src/engine.py e src/importer.py)

`load_data(source_dir)` retorna JSON serializável com `merchants`, `rates`, `accounts`, `checkout`, `remittances`, `bank`, `sources`, `import_warnings`.

`calculate(data, parameters=None)` retorna `comissoes`, `divergencias`, `notas`, `lancamentos`, `pendencias`, `rastro`, `details`, `summary`. Dinheiro em strings decimais com duas casas; taxas percentuais em strings decimais. Não usar float para cálculo financeiro.

As seis listas correspondem aos CSVs oficiais. Pendências têm também `severity` (informativo/atencao/bloqueante), `suggestion`, `evidence`, `rule`. IDs determinísticos. `details` é uma lista de detalhes de cálculo com `ref_origem`, `arquivo_origem`, `regra`, `formula`, valores e informações de contrato. `summary` tem `checkout_brl`, `remessa_brl`, `divergencias_brl`, `notas_brl`, `checkout_count`, `remessa_count`, `bank_count`.

Merchants: `cnpj`, `name`, `ec`, `active`, `source_ref`. Rates: `id`, `cnpj`, `product`, `start`, `end` (vazio = aberto), `rate_pct`, `source_file`, `source_ref`. Accounts: `code`, `name`, `postable`. Fontes: `name`, `sha256`, `rows`. Pode adicionar campos, preservando estes.

## Interface HTTP

GET `/api/state`: `{period, closing, summary, results, merchants, rates, accounts, parameters, contacts, notifications, emails, audit, sources, assumptions, validation}`. `results` é o resultado do motor; pendências acrescentam status (`open`, `resolved`, `rejected`), decisão e assinatura.

GET `/api/trace?id=...`: `{rows, details}`.
GET `/api/export?file=comissoes_por_lojista.csv` (e os demais cinco CSVs).
GET `/api/report`: HTML imprimível e baixável.
GET `/api/export.zip`: seis CSVs + relatório + hipóteses.

Todos POST recebem `actor` obrigatório. Retornam `{ok:true,...}` ou status 400/409 com `{error}`.

- `/api/recalculate`: `{actor, period}` (YYYY-MM).
- `/api/decisions`: `{actor,id,action,note,account_code?}`. action confirm resolve encaminhamento; reject mantém aberta; adjust registra encaminhamento ajustado (conta contábil obrigatória para reclassificação). Mudança de taxa/valor é feita no cadastro e recalculada, nunca como número solto.
- `/api/close`: `{actor,allow_open,reason}`. Com pendência aberta exige aceite explícito e justificativa. Recalcular ou editar referência reabre o fechamento.
- `/api/reopen`: `{actor,reason}`.
- `/api/rates`: `{actor,id?,cnpj,product,start,end,rate_pct,reason}`; período sobreposto é recusado, lacunas geram alerta. Histórico em auditoria.
- `/api/merchants`: `{actor,cnpj,name,ec,active,reason}`.
- `/api/parameters`: `{actor,remittance_tolerance_pp,closing_deadline,reason}`.
- `/api/contacts`: `{actor,id?,name,email,kind,cnpj,min_severity,frequency,enabled}`; kind internal/billing; frequency immediate/digest; severidade informativo/atencao/bloqueante.
- `/api/emails/draft`: `{actor,invoice_id}` gera cobrança de nota ou `{actor,issue_id}` gera contestação; sem contato configurado destinatário fica vazio para revisão. `{actor,report:true}` gera encaminhamento interno do relatório.
- `/api/emails/save`: `{actor,id,to,subject,body}`; edição invalida aprovação.
- `/api/emails/approve`: `{actor,id}` aprova versão exata do conteúdo.
- `/api/emails/send`: `{actor,id}` somente simulação, exige aprovação para cobrança/contestação.
- `/api/notifications/run`: `{actor}` processa resumo, prazos e notificações internas em simulação.
- `/api/import`: `{actor,source_dir,period}` importa arquivos no mesmo formato a partir de pasta local; valida e reapresenta fontes. Não modificar originais.

Nenhum envio real nesta versão. Não existe credencial embutida. Remetentes fictícios não são usados como destinatários reais.
