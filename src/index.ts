import path from 'path';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import swaggerDocument from 'swagger-jsdoc'

const app = express();
const port = process.env.PORT || 3030;

const options = {
    definition: {
        openapi: '3.1.0',
        info: {
            title: 'Video to Audio API with Swagger',
            version: '0.1.0',
            description: 'This is a simple CRUD API application made with Express and documented with Swagger',
        },
        servers: [
            {
                url: 'http://localhost:3030',
            },
        ],
    },
    apis: [path.resolve(__dirname, './routes/*.ts')],
};

const swaggerSpec = swaggerDocument(options);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

