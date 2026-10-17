# Histórico de uso da IA

Este diretório preserva os pedidos e resumos que já estavam no repositório e acrescenta exports das conversas locais recuperáveis, conforme as [instruções oficiais](../demo/back/docs/01_instrucoes_participantes.docx). Os [quatro momentos selecionados](MOMENTOS.md) apontam para pedidos, respostas e intervenções humanas reais; os resumos antigos não substituem os transcripts.

## Cobertura recuperada

Snapshot de **17/10/2026, 17:20:45 em São Paulo** (corte exato UTC no manifesto): **56 sessões Codex, 11 conversas principais e 45 subagentes, 8.030 eventos**, aproximadamente **28,8 MB** de JSONL textual; o maior arquivo tem 4,68 MB. Foram examinados somente os metadados das sessões locais de **16 e 17/10/2026**, e o conteúdo foi exportado apenas quando o `cwd` pertencia ao pacote Tarvo ou a seus descendentes; sessões de outros projetos não foram exportadas.

O [manifesto](transcripts/2026-10-17-local/manifest.json) registra a origem de cada export, seus hashes SHA-256, contagens, intervalo temporal, redacções, eventos omitidos e a correspondência entre a linha exportada e a linha da fonte. Relações entre conversa e subagentes são explícitas; contextos herdados podem aparecer repetidos e não representam novas falas humanas.

**É um snapshot, não uma declaração de completude de todo o time.** O corte inclui esta auditoria e o pedido de adequação, mas não inclui todas as ações ou a resposta final que ocorreram depois dele; outras conversas também podiam estar em andamento. Chamadas de ferramenta ainda sem retorno no corte são contadas no manifesto, e nenhuma resposta ausente foi reconstruída.

### Conversas principais

Horários abaixo em São Paulo; o nome do arquivo preserva a data/hora local de criação da sessão, enquanto os eventos internos guardam timestamps UTC.

| Conversa | Primeiro evento | Último evento no snapshot | Eventos | Histórico |
|---|---|---|---:|---|
| Preparação: case, regras e respostas do financeiro | 16/10 19:49:57 | 16/10 20:56:18 | 108 | [JSONL](transcripts/2026-10-17-local/2026-10-16T19-49-55-01a146e8-5c5c-7bc2-aee5-36cf527e94d7.jsonl) |
| MVP, pipeline, Gmail e verificação de novos arquivos | 16/10 23:14:38 | 17/10 15:02:57 | 1532 | [JSONL](transcripts/2026-10-17-local/2026-10-16T23-14-36-01a147a3-c1f5-70c1-b579-f69215ed6dc8.jsonl) |
| Especificação da integração de e-mail | 17/10 09:12:33 | 17/10 10:55:08 | 51 | [JSONL](transcripts/2026-10-17-local/2026-10-17T09-12-31-01a149c7-2b18-75b1-bdbb-97d31735c648.jsonl) |
| Integração front/back, saídas e continuidade mensal | 17/10 11:00:48 | 17/10 14:38:16 | 407 | [JSONL](transcripts/2026-10-17-local/2026-10-17T11-00-47-01a14a2a-46ba-7bd2-896f-948298b6b9f4.jsonl) |
| E-mail de demonstração, avisos e recomendações | 17/10 14:58:59 | 17/10 15:55:33 | 509 | [JSONL](transcripts/2026-10-17-local/2026-10-17T14-58-57-01a14b04-5408-79e1-aa9e-c482a7e5f822.jsonl) |
| Cadastro e revisão por empresa | 17/10 15:15:23 | 17/10 15:54:15 | 352 | [JSONL](transcripts/2026-10-17-local/2026-10-17T15-15-21-01a14b13-59f8-7540-a80b-2c4f16e82733.jsonl) |
| Decisões e experiência de revisão | 17/10 15:16:41 | 17/10 15:39:54 | 384 | [JSONL](transcripts/2026-10-17-local/2026-10-17T15-16-39-01a14b14-87a6-7f63-a9b5-2c07f1dc2ca7.jsonl) |
| Consolidação, versão executada e hipóteses na interface | 17/10 16:00:27 | 17/10 16:35:05 | 336 | [JSONL](transcripts/2026-10-17-local/2026-10-17T16-00-25-01a14b3c-9bba-79b3-95e6-84bea859e45b.jsonl) |
| Preparação da apresentação e auditoria da demonstração | 17/10 16:42:35 | 17/10 17:01:33 | 51 | [JSONL](transcripts/2026-10-17-local/2026-10-17T16-42-33-01a14b63-2db1-77d2-a0e1-7416ba5f082d.jsonl) |
| Clareza da revisão e dos formulários | 17/10 17:04:41 | 17/10 17:20:44 | 186 | [JSONL](transcripts/2026-10-17-local/2026-10-17T17-04-39-01a14b77-6ac6-7512-a5bb-3ea91856c0c5.jsonl) |
| Auditoria e adequação deste repositório (sessão corrente) | 17/10 17:07:38 | 17/10 17:20:38 | 116 | [JSONL](transcripts/2026-10-17-local/2026-10-17T17-07-37-01a14b7a-1dfb-78a0-b616-4f68a88016ae.jsonl) |

### Sessões delegadas

Estes registros incluem as tarefas e respostas de coordenação dos agentes e suas ferramentas, não o raciocínio interno dos modelos. A coluna de origem usa os primeiros oito caracteres do identificador da conversa; o manifesto contém o identificador completo.

| Tarefa | Conversa de origem | Eventos | Histórico |
|---|---|---:|---|
| `/root/checkout_rules` | `01a146e8` | 27 | [JSONL](transcripts/2026-10-17-local/2026-10-16T19-50-26-01a146e8-d375-7433-854f-87b74c855ef5.jsonl) |
| `/root/remessas_bancos` | `01a146e8` | 26 | [JSONL](transcripts/2026-10-17-local/2026-10-16T19-50-33-01a146e8-f15e-7481-86ce-db1b39659fd6.jsonl) |
| `/root/revisao_escopo` | `01a146e8` | 25 | [JSONL](transcripts/2026-10-17-local/2026-10-16T19-51-13-01a146e9-8e4d-7843-8640-ef9fb91785d9.jsonl) |
| `/root/audit_case_data` | `01a147a3` | 566 | [JSONL](transcripts/2026-10-17-local/2026-10-16T23-15-10-01a147a4-46cb-73f1-824e-d32f1b2ea8d5.jsonl) |
| `/root/web_interface` | `01a147a3` | 420 | [JSONL](transcripts/2026-10-17-local/2026-10-16T23-17-59-01a147a6-d96e-7260-a04f-1d333d572874.jsonl) |
| `/root/quality_tests` | `01a147a3` | 584 | [JSONL](transcripts/2026-10-17-local/2026-10-16T23-27-56-01a147af-f50c-78f3-a476-55906fb2d61c.jsonl) |
| `/root/email_context` | `01a149c7` | 23 | [JSONL](transcripts/2026-10-17-local/2026-10-17T09-12-40-01a149c7-4de5-7d62-8c31-0c6675dff76b.jsonl) |
| `/root/agent_contract` | `01a14a2a` | 128 | [JSONL](transcripts/2026-10-17-local/2026-10-17T11-01-20-01a14a2a-c93b-7343-bcbb-00c345f3523a.jsonl) |
| `/root/backend_contract` | `01a14a2a` | 112 | [JSONL](transcripts/2026-10-17-local/2026-10-17T11-01-27-01a14a2a-e65c-72c0-98a3-9bbad8a21448.jsonl) |
| `/root/mail_front` | `01a14a2a` | 74 | [JSONL](transcripts/2026-10-17-local/2026-10-17T11-01-36-01a14a2b-0691-7c83-8fa4-8a5044fd91de.jsonl) |
| `/root/output_path_review` | `01a14a2a` | 25 | [JSONL](transcripts/2026-10-17-local/2026-10-17T11-58-10-01a14a5e-d2fd-7342-8aaf-9cee2c4e44e2.jsonl) |
| `/root/strict_csv_prompt_review` | `01a14a2a` | 32 | [JSONL](transcripts/2026-10-17-local/2026-10-17T12-41-22-01a14a86-5f74-7b41-89d8-8f9d036e09c3.jsonl) |
| `/root/explain_pending_columns` | `01a14a2a` | 28 | [JSONL](transcripts/2026-10-17-local/2026-10-17T12-45-00-01a14a89-b0f1-7492-bbe6-cd688e610b83.jsonl) |
| `/root/new_orbe_intake_audit` | `01a14a2a` | 40 | [JSONL](transcripts/2026-10-17-local/2026-10-17T14-13-05-01a14ada-54f1-7ef3-8df9-e427ab877dd9.jsonl) |
| `/root/implementation_prompt_acceptance` | `01a14a2a` | 30 | [JSONL](transcripts/2026-10-17-local/2026-10-17T14-33-52-01a14aed-5d31-7cf3-9dd8-3809c66f094a.jsonl) |
| `/root/simple_mail_auth` | `01a14b04` | 63 | [JSONL](transcripts/2026-10-17-local/2026-10-17T14-59-56-01a14b05-3a36-7172-a102-416e9695b366.jsonl) |
| `/root/run_notifications` | `01a14b04` | 57 | [JSONL](transcripts/2026-10-17-local/2026-10-17T15-00-17-01a14b05-8b6a-7ed0-90bf-c1965aa771fb.jsonl) |
| `/root/demo_email_ui` | `01a14b04` | 66 | [JSONL](transcripts/2026-10-17-local/2026-10-17T15-00-41-01a14b05-ec60-7042-b42a-da088b5e0c20.jsonl) |
| `/root/registration_scope` | `01a14b13` | 87 | [JSONL](transcripts/2026-10-17-local/2026-10-17T15-15-36-01a14b13-9186-7b13-a20a-13348462491c.jsonl) |
| `/root/decision_audit` | `01a14b14` | 136 | [JSONL](transcripts/2026-10-17-local/2026-10-17T15-16-55-01a14b14-c700-7a10-be82-ba5f14dc0ac1.jsonl) |
| `/root/review_experience` | `01a14b14` | 104 | [JSONL](transcripts/2026-10-17-local/2026-10-17T15-16-58-01a14b14-d3a2-7342-a10e-e037b82f9c64.jsonl) |
| `/root/gmail_authorization_check` | `01a14b04` | 14 | [JSONL](transcripts/2026-10-17-local/2026-10-17T15-20-21-01a14b17-ee67-7e73-a394-711e119bcb98.jsonl) |
| `/root/safety_review` | `01a14b14` | 53 | [JSONL](transcripts/2026-10-17-local/2026-10-17T15-21-43-01a14b19-2b51-7191-8893-21ec743b7bec.jsonl) |
| `/root/registration_ui` | `01a14b13` | 83 | [JSONL](transcripts/2026-10-17-local/2026-10-17T15-22-13-01a14b19-a1a7-72a3-86f0-81f3db55bc16.jsonl) |
| `/root/registration_review` | `01a14b13` | 138 | [JSONL](transcripts/2026-10-17-local/2026-10-17T15-22-20-01a14b19-bbeb-7120-9125-25bbb0ce967f.jsonl) |
| `/root/contestacao_flow_review` | `01a14b04` | 18 | [JSONL](transcripts/2026-10-17-local/2026-10-17T15-22-28-01a14b19-de6a-7ae2-beeb-f138bbd656ca.jsonl) |
| `/root/suggestion_backend` | `01a14b04` | 150 | [JSONL](transcripts/2026-10-17-local/2026-10-17T15-25-39-01a14b1c-c635-7543-996a-75ec9aa59f30.jsonl) |
| `/root/suggestion_ui` | `01a14b04` | 85 | [JSONL](transcripts/2026-10-17-local/2026-10-17T15-27-45-01a14b1e-b1df-7042-94ba-b7185aca144b.jsonl) |
| `/root/suggestion_api_tests` | `01a14b04` | 166 | [JSONL](transcripts/2026-10-17-local/2026-10-17T15-28-01-01a14b1e-f21a-73b1-a554-fdff2688ebc1.jsonl) |
| `/root/audit_email` | `01a14b3c` | 58 | [JSONL](transcripts/2026-10-17-local/2026-10-17T16-00-49-01a14b3c-f91b-7d72-89c6-2c716f70e9f5.jsonl) |
| `/root/audit_main` | `01a14b3c` | 52 | [JSONL](transcripts/2026-10-17-local/2026-10-17T16-00-54-01a14b3d-0a9e-75b2-a13f-fb392e5fced2.jsonl) |
| `/root/integration_tests` | `01a14b3c` | 48 | [JSONL](transcripts/2026-10-17-local/2026-10-17T16-02-36-01a14b3e-9b59-7ae3-8cb5-180f63aef487.jsonl) |
| `/root/hypotheses_diagnosis` | `01a14b3c` | 28 | [JSONL](transcripts/2026-10-17-local/2026-10-17T16-22-30-01a14b50-d4bb-78b0-9a5d-d853646953e7.jsonl) |
| `/root/runtime_version_check` | `01a14b3c` | 8 | [JSONL](transcripts/2026-10-17-local/2026-10-17T16-25-44-01a14b53-c7c9-7743-ba76-714a8614a524.jsonl) |
| `/root/compare_local_preview` | `01a14b3c` | 20 | [JSONL](transcripts/2026-10-17-local/2026-10-17T16-26-50-01a14b54-c9cb-75b0-ab0b-cbf4b68c7fd4.jsonl) |
| `/root/audit_runtime_upgrade` | `01a14b3c` | 22 | [JSONL](transcripts/2026-10-17-local/2026-10-17T16-28-45-01a14b56-8d77-7951-b255-31217904526c.jsonl) |
| `/root/hypotheses_visibility_check` | `01a14b3c` | 24 | [JSONL](transcripts/2026-10-17-local/2026-10-17T16-33-11-01a14b5a-9a5f-7113-b29d-5e81621c5a53.jsonl) |
| `/root/auditar_numeros` | `01a14b63` | 31 | [JSONL](transcripts/2026-10-17-local/2026-10-17T16-42-46-01a14b63-6187-7fc1-a847-a937fed10438.jsonl) |
| `/root/auditar_demo` | `01a14b63` | 26 | [JSONL](transcripts/2026-10-17-local/2026-10-17T16-42-49-01a14b63-6dbc-7a80-b546-8ab794cbd030.jsonl) |
| `/root/revisar_roteiro_video` | `01a14b63` | 5 | [JSONL](transcripts/2026-10-17-local/2026-10-17T17-00-23-01a14b73-805b-7003-b1f3-336392316706.jsonl) |
| `/root/clareza_revisao` | `01a14b77` | 54 | [JSONL](transcripts/2026-10-17-local/2026-10-17T17-04-53-01a14b77-a1ee-7a73-b185-c25e529c022c.jsonl) |
| `/root/formulario_claro` | `01a14b77` | 71 | [JSONL](transcripts/2026-10-17-local/2026-10-17T17-06-23-01a14b79-0045-7932-9b13-47b3d1b0917b.jsonl) |
| `/root/audit_outputs` | `01a14b7a` | 42 | [JSONL](transcripts/2026-10-17-local/2026-10-17T17-07-59-01a14b7a-76fd-7183-91cf-750cde3621b8.jsonl) |
| `/root/audit_history` | `01a14b7a` | 43 | [JSONL](transcripts/2026-10-17-local/2026-10-17T17-08-03-01a14b7a-85af-7a63-a242-f51e189ba6ba.jsonl) |
| `/root/audit_repro` | `01a14b7a` | 106 | [JSONL](transcripts/2026-10-17-local/2026-10-17T17-08-07-01a14b7a-94f5-7773-8ed6-ef8c57704414.jsonl) |

## Histórico anterior preservado

Os arquivos abaixo permanecem como estavam antes desta complementação:

- [01_scaffold.md](01_scaffold.md): pedido e resumo do scaffold em Claude Code.
- [02_prompt_MVP.md](02_prompt_MVP.md): prompt de construção do MVP.
- [03_front_back.md](03_front_back.md): resumo da reorganização e verificações.
- [04_redesign_front.md](04_redesign_front.md): resumo de decisões e fases do front.
- [05_mesa_dados_chat.md](05_mesa_dados_chat.md): resumo de decisões e fases da mesa de dados/chat, com trechos abreviados.
- [PEDIDO_ORIGINAL.txt](PEDIDO_ORIGINAL.txt), [PEDIDO_PIPELINE.txt](PEDIDO_PIPELINE.txt) e [PEDIDO_EMAIL_GMAIL.txt](PEDIDO_EMAIL_GMAIL.txt): textos dos pedidos registrados anteriormente.
- [SESSAO_23-14-36](SESSAO_23-14-36-01a147a3-c1f5-70c1-b579-f69215ed6dc8.jsonl), [SESSAO_23-15-10](SESSAO_23-15-10-01a147a4-46cb-73f1-824e-d32f1b2ea8d5.jsonl), [SESSAO_23-17-59](SESSAO_23-17-59-01a147a6-d96e-7260-a04f-1d333d572874.jsonl) e [SESSAO_23-27-56](SESSAO_23-27-56-01a147af-f50c-78f3-a476-55906fb2d61c.jsonl): os quatro snapshots originais; versões posteriores dessas mesmas sessões constam no lote acima.
- [MOMENTOS anterior](resumos/MOMENTOS_anterior_2026-10-17.md): cópia exata do texto anterior com cinco momentos, mantida como registro, não como a seleção atual exigida.
- [Exportador anterior](exportar_sessoes.py): preservado para rastrear como os primeiros quatro arquivos foram produzidos.

## Lacunas que ainda dependem do time

1. **Claude Code:** o diretório local padrão `~/.claude/projects` não existe nesta máquina; não foi possível recuperar os transcripts completos das sessões descritas em `01_scaffold.md`, `03_front_back.md`, `04_redesign_front.md` e `05_mesa_dados_chat.md`. Esses resumos não comprovam integralidade; os integrantes que executaram essas sessões precisam anexar os exports originais ou links acessíveis, preservando o conteúdo salvo remoção de chaves e dados pessoais.
2. **Outras máquinas, contas e ferramentas:** o inventário cobre somente este Codex local e as datas acima; não comprova que a preparação e construção de todos os integrantes estejam presentes. Sessões fora desse escopo devem ser adicionadas pelo responsável, sem inventar diálogos nem apresentar resumos como transcrição.
3. **Sessões em andamento e eventos após o corte:** esta conversa e qualquer trabalho posterior ao snapshot precisam de um export final adicional quando concluídos; o snapshot atual não é atualizado continuamente nem substituído em silêncio.
4. **Mídia e anexos:** 50 blocos binários encontrados nos eventos foram substituídos por referências/hash e indicação de omissão para não versionar pixels/base64. O texto das mensagens e ferramentas permanece, salvo as redacções descritas abaixo; não foi criada transcrição visual nem OCR. Arquivos citados por caminhos locais podem não estar no repositório: a referência comprova a menção, não a disponibilidade do anexo.

## Política de exportação e privacidade

O [exportador deste snapshot](exportar_historico.py) mantém mensagens de usuário e assistente, chamadas/retornos de ferramentas e mensagens explícitas de coordenação entre agentes. Exclui os eventos de raciocínio interno, canais `analysis`/`summary`, mensagens `system`/`developer`, contexto automático da aplicação e metadados privados; uma sessão interna de controle sem conversa foi excluída antes da exportação.

No conteúdo publicável, o script remove padrões de credenciais, tokens OAuth, endereços de e-mail, nomes de contas em caminhos pessoais e identificadores privados da integração/browser. Marcadores como `[CREDENCIAL_REMOVIDA]`, `[EMAIL_REMOVIDO]` e `[USUARIO]` tornam essas remoções explícitas; as contagens por categoria estão no manifesto, sem guardar os valores removidos. A aplicação preventiva também pode substituir endereços/credenciais de demonstração presentes em exemplos de código. Não foram reescritas as decisões, falas, erros ou resultados, e os arquivos legados não foram reprocessados.

O hash da fonte identifica os bytes locais lidos naquele instante; a filtragem temporal aplica o corte comum indicado no manifesto. O hash do export identifica o arquivo publicável resultante, sem pretender que ele seja idêntico à fonte que contém contexto privado e mídia. Validação por padrões não garante a detecção de todos os dados pessoais possíveis: antes de publicar o repositório, a equipe deve conferir o material no contexto de suas contas e anexos.

Para gerar outro snapshot **em uma nova pasta**, sem substituir este:

```sh
python3 PROMPTS/exportar_historico.py --output PROMPTS/transcripts/OUTRO_SNAPSHOT
```

O script limita a descoberta às mesmas datas e ao pacote do projeto, rejeita JSON inválido no meio de uma sessão e registra eventual último evento ainda em gravação. Os JSONL devem ser lidos por quebras `\n`, não por separadores Unicode presentes dentro do texto original.
