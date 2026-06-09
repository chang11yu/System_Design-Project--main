import os

from flask import Flask, abort, jsonify, send_from_directory
from flask_cors import CORS
from config import Config
from extensions import db

def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    cors_origins = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "*").split(",")
        if origin.strip()
    ]
    CORS(app, resources={r"/*": {"origins": cors_origins}})
    db.init_app(app)

    with app.app_context():
        from models.Inventory import Inventory
        from models.Product import Product
        from models.Purchase import Purchase
        from models.Sales import Sales  
        from models.Supplier import Supplier
        from models.BOM import BOM
        from models.Scrap_record import ScrapRecord
        db.create_all()
        from utils.schema import ensure_purchase_columns
        ensure_purchase_columns()
        from seed_data import seed_database
        seed_database()
        from utils.sales import consolidate_daily_sales
        consolidate_daily_sales()

    @app.route("/")
    def index():
        return send_from_directory(app.root_path, "index.html")

    @app.route("/health")
    def health():
        return jsonify({"status": "ok"})

    @app.route("/<path:filename>")
    def static_files(filename):
        if filename not in {"style.css", "script.js", "api-config.js"}:
            abort(404)
        return send_from_directory(app.root_path, filename)

    # 在 Flask 後端寫一個大打包的 API，取代原本的 get_data.php
    @app.route("/api/get_all_data", methods=["GET"])
    def get_all_data():
        try:
          from models.Inventory import Inventory
          from models.Product import Product
          from models.Purchase import Purchase
          from models.Sales import Sales  
          from models.Supplier import Supplier
          from models.BOM import BOM
          from models.Scrap_record import ScrapRecord

          return jsonify({
            "success": True,
            "products": [p.to_dict() for p in Product.query.all()],
            "inventory": [i.to_dict() for i in Inventory.query.all()],
            "purchaseOrders": [p.to_dict() for p in Purchase.query.all()],
            "salesRecords": [s.to_dict() for s in Sales.query.all()],
            "suppliers": [s.to_dict() for s in Supplier.query.all()],
            "bomRecords": [b.to_dict() for b in BOM.query.all()],
            "wasteRecords": [r.to_dict() for r in ScrapRecord.query.all()]
          })
        except Exception as e:
            return jsonify({"success": False, "message": str(e)}), 500

    # 匯入 Blueprint：Flask 的模組化路由機制
    from routes.supplier_routes import supplier_bp
    from routes.inventory_routes import inventory_bp
    from routes.purchase_routes import purchase_bp
    from routes.sales_routes import sales_bp
    from routes.forecast_routes import forecast_bp
    from routes.report_routes import report_bp

    # 註冊 Blueprint
    app.register_blueprint(supplier_bp)
    app.register_blueprint(inventory_bp)
    app.register_blueprint(purchase_bp)
    app.register_blueprint(sales_bp)
    app.register_blueprint(forecast_bp)
    app.register_blueprint(report_bp)

    return app

app = create_app()

if __name__ == "__main__":
    app.run(
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "5000")),
        debug=False,
        use_reloader=False
    )
