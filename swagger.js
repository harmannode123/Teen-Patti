const swaggerAutogen = require('swagger-autogen')()

const outputFile = './swagger_output.json'
const endpointsFiles = ['./app.js', './route/v1/index.route.js']

swaggerAutogen(outputFile, endpointsFiles).then(() => { require('./app.js') })