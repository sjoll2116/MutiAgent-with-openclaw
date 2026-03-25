"""add parent_id to document_chunks

Revision ID: 003_add_parent_id
Revises: 002_add_document_chunks
Create Date: 2026-03-24 14:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '003_add_parent_id'
down_revision: Union[str, None] = '002_add_document_chunks'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # add parent_id column
    op.add_column('document_chunks', sa.Column('parent_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_document_chunks_parent_id'), 'document_chunks', ['parent_id'], unique=False)
    op.create_foreign_key('fk_document_chunks_parent_id', 'document_chunks', 'document_chunks', ['parent_id'], ['id'], ondelete='CASCADE')


def downgrade() -> None:
    op.drop_constraint('fk_document_chunks_parent_id', 'document_chunks', type_='foreignkey')
    op.drop_index(op.f('ix_document_chunks_parent_id'), table_name='document_chunks')
    op.drop_column('document_chunks', 'parent_id')
