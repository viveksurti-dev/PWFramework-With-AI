import java.sql.*;

public class DatabaseConnectionByJava {
    public static void main(String[] args) {
        if (args.length < 6) {
            System.out.println("Usage: java DatabaseConnectionByJava <driver> <url> <user> <password> <query> <columnName>");
            return;
        }
        
        String driver = args[0];
        String url = args[1];
        String user = args[2];
        String password = args[3];
        String query = args[4];
        String columnName = args[5];
        
        Connection conn = null;
        try {
            Class.forName(driver);
            conn = DriverManager.getConnection(url, user, password);
            Statement stmt = conn.createStatement();
            ResultSet rs = stmt.executeQuery(query);
            
            if (rs.next()) {
                String result = columnName.isEmpty() ? rs.getString(1) : rs.getString(columnName);
                System.out.println("RESULT:" + result);
            } else {
                System.out.println("RESULT:null");
            }
            
            rs.close();
            stmt.close();
            conn.close();
        } catch (Exception e) {
            System.err.println("ERROR:" + e.getMessage());
        }
    }
}
