from flask import Flask, jsonify, request
from flask_cors import CORS
from test_par_impar import eh_par, eh_impar

app = Flask(__name__)
CORS(app)

@app.route('/verificar', methods=['POST'])
def verificar():
    try:
        numero = int(request.json.get('numero'))
        return jsonify({
            'numero': numero,
            'par': eh_par(numero),
            'impar': eh_impar(numero),
            'resultado': 'PAR' if eh_par(numero) else 'ÍMPAR'
        })
    except:
        return jsonify({'erro': 'Número inválido'}), 400

if __name__ == '__main__':
    app.run(debug=True, port=5000)
