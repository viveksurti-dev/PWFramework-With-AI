const { execSync } = require('child_process');
const path = require('path');
const JSConnection = require('./DBConnection/JS/JSConnection.js');

// Database Configuration
const DB_CONFIG = {
    qa_mysql_hsbc: {
        type: 'mysql',
        host: '10.128.160.52',
        user: 'oampsb',
        password: 'zGAMv9!2',
        port: '3306'
    },
    qa_oracle_jansuraksha: {
        type: 'oracle',
        user: 'admin',
        password: 'DyyyK]h9',
        connectString: 'qa-db-jansuraksha.czm2f3npmmw4.ap-south-1.rds.amazonaws.com:1521/orcl'
    },
    qa_oracle_ib_migration: {
        type: 'oracle_port',
        host: '10.192.40.1',
        user: 'readonly_qa_user',
        password: 'oracleqa',
        port: '1521',
        serviceName: 'ORCLCDB'
    }
};

class DBQuery {
    constructor() {
        this.jsConnection = new JSConnection();
        this.environment = null;
        this.javaPath = path.join(__dirname, 'DBConnection', 'Java');
    }

    async connect(environment = 'qa_mysql_hsbc') {
        const config = DB_CONFIG[environment];
        this.environment = environment;
        
        try {
            await this.jsConnection.connect(config);
            console.log(`✓ Database connection established for environment: ${environment}`);
        } catch (error) {
            console.error('Database connection failed:', error.message);
            throw error;
        }
    }

    async executeQueryByJS(query, columnName = '') {
        try {
            console.log('Executing Query (JS):', query);
            return await this.jsConnection.executeQuery(query, columnName);
        } catch (error) {
            console.error('Query execution failed:', error.message);
            return { rows: [[null]] };
        }
    }

    async executeQueryByJava(query, columnName = '') {
        try {
            console.log('Executing Query (Java):', query);
            
            const config = DB_CONFIG[this.environment];
            let driver, url;
            
            if (config.type === 'mysql') {
                driver = 'com.mysql.cj.jdbc.Driver';
                url = `jdbc:mysql://${config.host}:${config.port}?autoReconnect=true&useSSL=false`;
            } else if (config.type === 'oracle') {
                driver = 'oracle.jdbc.driver.OracleDriver';
                url = `jdbc:oracle:thin:@//${config.connectString}`;
            } else if (config.type === 'oracle_port') {
                driver = 'oracle.jdbc.driver.OracleDriver';
                url = `jdbc:oracle:thin:@//${config.host}:${config.port}/${config.serviceName}`;
            }
            
            const output = execSync(
                `cd "${this.javaPath}" && java -cp ".;ojdbc8-21.9.0.0.jar;mysql-connector-j-8.0.33.jar;protobuf-java-3.21.9.jar" DatabaseConnectionByJava "${driver}" "${url}" "${config.user}" "${config.password}" "${query.replace(/"/g, '\\"')}" "${columnName}"`,
                { encoding: 'utf-8' }
            );
            
            const match = output.match(/RESULT:(.*)/);            
            const result = match ? match[1].trim() : null;
            return { rows: [[result]] };
        } catch (error) {
            console.error('Java query execution failed:', error.message);
            return { rows: [[null]] };
        }
    }

    async getValueFromDBJS(query) {
        try {
            const result = await this.executeQueryByJS(query);
            return result.rows[0] ? result.rows[0][0] : null;
        } catch (error) {
            console.error('Failed to get value from DB (JS):', error.message);
            return null;
        }
    }

    async getValueFromDBJava(query) {
        try {
            const result = await this.executeQueryByJava(query);
            return result.rows[0] ? result.rows[0][0] : null;
        } catch (error) {
            console.error('Failed to get value from DB (Java):', error.message);
            return null;
        }
    }

    async close() {
        await this.jsConnection.close();
        console.log('✓ Database connection closed.');
    }
}

module.exports = { DBQuery, DB_CONFIG };
