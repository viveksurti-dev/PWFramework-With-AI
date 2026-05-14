const mysql = require('mysql2/promise');
const oracledb = require('oracledb');

class JSConnection {
    constructor() {
        this.connection = null;
        this.dbType = null;
    }

    async connect(config) {
        this.dbType = config.type;
        
        try {
            if (config.type === 'mysql') {
                this.connection = await mysql.createConnection({
                    host: config.host,
                    user: config.user,
                    password: config.password,
                    port: config.port
                });
            } else if (config.type === 'oracle') {
                this.connection = await oracledb.getConnection({
                    user: config.user,
                    password: config.password,
                    connectString: config.connectString
                });
            } else if (config.type === 'oracle_port') {
                this.connection = await oracledb.getConnection({
                    user: config.user,
                    password: config.password,
                    connectString: `${config.host}:${config.port}/${config.serviceName}`
                });
            }
        } catch (error) {
            throw error;
        }
    }

    async executeQuery(query, columnName = '') {
        if (!this.connection) {
            throw new Error('Database not connected.');
        }

        try {
            if (this.dbType === 'mysql') {
                const [rows] = await this.connection.execute(query);
                return { rows: rows.length > 0 ? [[rows[0][columnName] || JSON.stringify(rows[0])]] : [[null]] };
            } else if (this.dbType === 'oracle' || this.dbType === 'oracle_port') {
                const result = await this.connection.execute(query);
                return { rows: result.rows };
            }
        } catch (error) {
            throw error;
        }
    }

    async close() {
        if (this.connection) {
            await this.connection.end ? await this.connection.end() : await this.connection.close();
            this.connection = null;
        }
    }
}

module.exports = JSConnection;
