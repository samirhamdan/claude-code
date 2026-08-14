-- Criar tabela usuarios
CREATE TABLE IF NOT EXISTS usuarios (
  numero VARCHAR(15) PRIMARY KEY,
  nome VARCHAR(100),
  nome_assistente VARCHAR(50) DEFAULT NULL,
  tom VARCHAR(20) DEFAULT NULL,
  idioma VARCHAR(10) DEFAULT 'pt-BR',
  revisao_dia VARCHAR(10) DEFAULT NULL,
  revisao_hora VARCHAR(5) DEFAULT NULL,
  planilha_id VARCHAR(60),
  trello_board_id VARCHAR(30),
  trello_list_id VARCHAR(30),
  trello_key VARCHAR(40),
  trello_token VARCHAR(80),
  modulos JSONB DEFAULT '["tarefas","gastos","contas"]',
  onboarding_completo BOOLEAN DEFAULT false,
  ativo BOOLEAN DEFAULT true,
  criado_em TIMESTAMP DEFAULT now()
);

-- Inserir registro do Samir
INSERT INTO usuarios (
  numero,
  nome,
  planilha_id,
  trello_board_id,
  trello_list_id,
  onboarding_completo
) VALUES (
  '556798283590',
  'Samir',
  '1n2zYgTP3reMH4XHKMGp9kcjoGrZvvW5b7pvw7MxTQFQ',
  '6a7e8330ecaf78018711005b',
  '6a7e8338c1c5d2be03bcc512',
  false
);
