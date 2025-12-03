import http.server
import socketserver
import webbrowser
import argparse
import os
from pathlib import Path


def get_project_root():
    """Find the project root containing index.html."""
    # When installed, static files are in the package directory's parent
    pkg_dir = Path(__file__).parent

    # Check if we're running from source (development)
    source_root = pkg_dir.parent.parent
    if (source_root / "index.html").exists():
        return source_root

    # Check package data directory
    if (pkg_dir / "static" / "index.html").exists():
        return pkg_dir / "static"

    # Fallback to current directory
    return Path.cwd()


def main():
    parser = argparse.ArgumentParser(description="DepthFlow WebGL - Parallax depth effect renderer")
    parser.add_argument("-p", "--port", type=int, default=8080, help="Port to serve on (default: 8080)")
    parser.add_argument("--no-browser", action="store_true", help="Don't open browser automatically")
    args = parser.parse_args()

    root = get_project_root()
    os.chdir(root)

    handler = http.server.SimpleHTTPRequestHandler

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", args.port), handler) as httpd:
        url = f"http://localhost:{args.port}"
        print(f"Serving DepthFlow WebGL at {url}")
        print(f"Root directory: {root}")
        print("Press Ctrl+C to stop")

        if not args.no_browser:
            webbrowser.open(url)

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down...")


if __name__ == "__main__":
    main()
