const path = require('path');

module.exports = {
  entry: './index.js', // Caminho para o seu arquivo de entrada
  output: {
    filename: 'bundle.js', // Nome do arquivo de saída
    path: path.resolve(__dirname, 'dist'), // Diretório de saída
  },
  mode: 'development', // Modo de desenvolvimento (ou 'production' para produção)
};