const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: './index.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  mode: 'development',
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'node_modules/pdfjs-dist/build/pdf.worker.mjs', to: 'pdf.worker.mjs' },
      ],
    }),
  ],
};