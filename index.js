以下は **Flask + SQLite** で構築した、最低限の機能だけを実装したシンプルな SNS のサンプルです。  
ディレクトリ構成は次の通りです。

```
sns/
│─ app.py
│─ models.py
│─ utils.py
│─ requirements.txt
│─ templates/
│   ├─ base.html
│   ├─ index.html
│   ├─ login.html
│   ├─ register.html
│   ├─ post.html
│   ├─ dm.html
│   └─ report.html
│─ static/
    └─ style.css
```

---

### 1. `requirements.txt`

```text
Flask==3.0.3
Flask-Login==0.6.3
Flask-WTF==1.2.1
email-validator==2.2.0
WTForms==3.1.2
SQLAlchemy==2.0.31
```

---

### 2. `models.py`（SQLAlchemy ORM）

```python
# models.py
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin

db = SQLAlchemy()


# ---------- User ----------
class User(UserMixin, db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(32), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)

    # relationships
    posts = db.relationship("Post", backref="author", cascade="all, delete-orphan")
    comments = db.relationship("Comment", backref="author", cascade="all, delete-orphan")
    sent_dms = db.relationship(
        "DM", foreign_keys="DM.sender_id", backref="sender", cascade="all, delete-orphan"
    )
    received_dms = db.relationship(
        "DM", foreign_keys="DM.receiver_id", backref="receiver", cascade="all, delete-orphan"
    )
    liked = db.relationship("Like", backref="user", cascade="all, delete-orphan")
    blocked = db.relationship(
        "Block",
        foreign_keys="Block.blocker_id",
        backref="blocker",
        cascade="all, delete-orphan",
    )
    reports = db.relationship("Report", backref="reporter", cascade="all, delete-orphan")


# ---------- Post ----------
class Post(db.Model):
    __tablename__ = "posts"
    id = db.Column(db.Integer, primary_key=True)
    body = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)

    comments = db.relationship("Comment", backref="post", cascade="all, delete-orphan")
    likes = db.relationship("Like", backref="post", cascade="all, delete-orphan")
    reports = db.relationship("Report", backref="post", cascade="all, delete-orphan")


# ---------- Comment ----------
class Comment(db.Model):
    __tablename__ = "comments"
    id = db.Column(db.Integer, primary_key=True)
    body = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    post_id = db.Column(db.Integer, db.ForeignKey("posts.id"), nullable=False)


# ---------- Like ----------
class Like(db.Model):
    __tablename__ = "likes"
    id = db.Column(db.Integer, primary_key=True)

    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    post_id = db.Column(db.Integer, db.ForeignKey("posts.id"), nullable=False)

    __table_args__ = (db.UniqueConstraint("user_id", "post_id", name="_user_post_like_uc"),)


# ---------- Block ----------
class Block(db.Model):
    __tablename__ = "blocks"
    id = db.Column(db.Integer, primary_key=True)

    blocker_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    blocked_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)

    __table_args__ = (db.UniqueConstraint("blocker_id", "blocked_id", name="_blocker_blocked_uc"),)


# ---------- Report ----------
class Report(db.Model):
    __tablename__ = "reports"
    id = db.Column(db.Integer, primary_key=True)
    reason = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    reporter_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    post_id = db.Column(db.Integer, db.ForeignKey("posts.id"), nullable=False)


# ---------- DM ----------
class DM(db.Model):
    __tablename__ = "dms"
    id = db.Column(db.Integer, primary_key=True)
    body = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    sender_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    receiver_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
```

---

### 3. `utils.py`（パスワードハッシュ・ログイン管理）

```python
# utils.py
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import LoginManager, login_user, logout_user, current_user

login_manager = LoginManager()
login_manager.login_view = "login"


def hash_password(pw: str) -> str:
    return generate_password_hash(pw)


def verify_password(pw_hash: str, pw: str) -> bool:
    return check_password_hash(pw_hash, pw)


def init_login(app):
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(user_id):
        from models import User

        return User.query.get(int(user_id))
```

---

### 4. `app.py`（メインアプリ）

```python
# app.py
import os
from flask import (
    Flask,
    render_template,
    redirect,
    url_for,
    flash,
    request,
    abort,
    jsonify,
)
from flask_wtf import FlaskForm
from wtforms import StringField, PasswordField, TextAreaField, SubmitField, HiddenField
from wtforms.validators import DataRequired, Length, Email, EqualTo, ValidationError
from flask_login import login_user, logout_user, login_required, current_user

from models import (
    db,
    User,
    Post,
    Comment,
    Like,
    Block,
    Report,
    DM,
)
from utils import hash_password, verify_password, init_login

# ---------- Flask 初期化 ----------
app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret-key")
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///sns.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db.init_app(app)
init_login(app)


# ---------- フォーム ----------
class RegisterForm(FlaskForm):
    username = StringField("Username", validators=[DataRequired(), Length(3, 32)])
    email = StringField("Email", validators=[DataRequired(), Email()])
    password = PasswordField("Password", validators=[DataRequired(), Length(6, 128)])
    confirm = PasswordField(
        "Confirm", validators=[DataRequired(), EqualTo("password")]
    )
    submit = SubmitField("Register")

    def validate_username(self, field):
        if User.query.filter_by(username=field.data).first():
            raise ValidationError("Username already taken")

    def validate_email(self, field):
        if User.query.filter_by(email=field.data).first():
            raise ValidationError("Email already registered")


class LoginForm(FlaskForm):
    email = StringField("Email", validators=[DataRequired(), Email()])
    password = PasswordField("Password", validators=[DataRequired()])
    submit = SubmitField("Login")


class PostForm(FlaskForm):
    body = TextAreaField("What’s on your mind?", validators=[DataRequired(), Length(max=500)])
    submit = SubmitField("Post")


class CommentForm(FlaskForm):
    body = TextAreaField("Comment", validators=[DataRequired(), Length(max=300)])
    post_id = HiddenField(validators=[DataRequired()])
    submit = SubmitField("Comment")


class DMForm(FlaskForm):
    receiver = StringField("To (username)", validators=[DataRequired()])
    body = TextAreaField("Message", validators=[DataRequired(), Length(max=1000)])
    submit = SubmitField("Send")


class ReportForm(FlaskForm):
    reason = StringField("Reason", validators=[DataRequired(), Length(max=255)])
    post_id = HiddenField(validators=[DataRequired()])
    submit = SubmitField("Report")


# ---------- ヘルパ ----------
def is_blocked(viewer: User, owner: User) -> bool:
    """viewer が owner にブロックされているか"""
    return Block.query.filter_by(blocker_id=owner.id, blocked_id=viewer.id).first() is not None


# ---------- ルート ----------
@app.route("/")
@login_required
def index():
    # 自分がブロックしたユーザー、または自分をブロックしたユーザーの投稿は除外
    blocked_ids = [b.blocked_id for b in Block.query.filter_by(blocker_id=current_user.id).all()]
    blocked_by_ids = [b.blocker_id for b in Block.query.filter_by(blocked_id=current_user.id).all()]
    hide_ids = set(blocked_ids + blocked_by_ids)

    posts = (
        Post.query.filter(~Post.user_id.in_(hide_ids))
        .order_by(Post.created_at.desc())
        .all()
    )
    post_form = PostForm()
    comment_form = CommentForm()
    report_form = ReportForm()
    return render_template(
        "index.html",
        posts=posts,
        post_form=post_form,
        comment_form=comment_form,
        report_form=report_form,
    )


@app.route("/register", methods=["GET", "POST"])
def register():
    if current_user.is_authenticated:
        return redirect(url_for("index"))
    form = RegisterForm()
    if form.validate_on_submit():
        user = User(
            username=form.username.data,
            email=form.email.data,
            password_hash=hash_password(form.password.data),
        )
        db.session.add(user)
        db.session.commit()
        flash("Registered successfully. Please log in.", "success")
        return redirect(url_for("login"))
    return render_template("register.html", form=form)


@app.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("index"))
    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data).first()
        if user and verify_password(user.password_hash, form.password.data):
            login_user(user)
            flash("Logged in.", "success")
            return redirect(url_for("index"))
        flash("Invalid credentials.", "danger")
    return render_template("login.html", form=form)


@app.route("/logout")
@login_required
def logout():
    logout_user()
    flash("Logged out.", "info")
    return redirect(url_for("login"))


# ---------- 投稿 ----------
@app.route("/post", methods=["POST"])
@login_required
def create_post():
    form = PostForm()
    if form.validate_on_submit():
        p = Post(body=form.body.data, author=current_user)
        db.session.add(p)
        db.session.commit()
        flash("Post created.", "success")
    else:
        flash("Failed to post.", "danger")
    return redirect(url_for("index"))


# ---------- いいね ----------
@app.route("/like/<int:post_id>", methods=["POST"])
@login_required
def like(post_id):
    post = Post.query.get_or_404(post_id)
    if is_blocked(current_user, post.author):
        abort(403)
    existing = Like.query.filter_by(user_id=current_user.id, post_id=post.id).first()
    if existing:
        db.session.delete(existing)
    else:
        db.session.add(Like(user_id=current_user.id, post_id=post.id))
    db.session.commit()
    return redirect(url_for("index"))


# ---------- コメント ----------
@app.route("/comment", methods=["POST"])
@login_required
def comment():
    form = CommentForm()
    if form.validate_on_submit():
        post = Post.query.get_or_404(int(form.post_id.data))
        if is_blocked(current_user, post.author):
            abort(403)
        c = Comment(body=form.body.data, author=current_user, post=post)
        db.session.add(c)
        db.session.commit()
        flash("Comment added.", "success")
    else:
        flash("Failed to comment.", "danger")
    return redirect(url_for("index"))


# ---------- ブロック ----------
@app.route("/block/<int:user_id>", methods=["POST"])
@login_required
def block(user_id):
    if user_id == current_user.id:
        abort(400)
    target = User.query.get_or_404(user_id)
    if Block.query.filter_by(blocker_id=current_user.id, blocked_id=target.id).first():
        flash("Already blocked.", "info")
    else:
        db.session.add(Block(blocker_id=current_user.id, blocked_id=target.id))
        db.session.commit()
        flash(f"Blocked {target.username}.", "warning")
    return redirect(url_for("index"))


# ---------- 通報 ----------
@app.route("/report", methods=["POST"])
@login_required
def report():
    form = ReportForm()
    if form.validate_on_submit():
        post = Post.query.get_or_404(int(form.post_id.data))
        r = Report(
            reason=form.reason