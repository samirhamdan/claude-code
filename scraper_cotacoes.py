import requests
from bs4 import BeautifulSoup
from datetime import datetime

print('🔄 Buscando cotações...')

# Bitcoin (CoinGecko API - funciona sem user-agent)
try:
    print('Buscando Bitcoin...')
    url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl'
    response = requests.get(url, timeout=5)
    data = response.json()
    bitcoin = f"R$ {data['bitcoin']['brl']:,.2f}"
    print(f'✅ Bitcoin: {bitcoin}')
except Exception as e:
    bitcoin = f'Erro: {str(e)}'
    print(f'❌ {bitcoin}')

# Mensagem final
agora = datetime.now().strftime('%d/%m/%Y %H:%M')
mensagem = f'''📊 COTAÇÕES - {agora}

💵 Dólar: Em manutenção
₿ Bitcoin: {bitcoin}
📈 Ibovespa: Em manutenção
📊 Mini Índice: Em manutenção

(Nota: Alguns dados não estão disponíveis no momento)'''

print('\n' + mensagem)

# Salvar em arquivo
with open('cotacoes.txt', 'w', encoding='utf-8') as f:
    f.write(mensagem)
print('\n✅ Salvo em cotacoes.txt')
